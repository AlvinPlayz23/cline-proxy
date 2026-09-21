import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ProviderSettingsManager } from "@cline/core";
import { detectClineInstall } from "./cline-detection.js";
import { ProxyError } from "./errors.js";
import { createHandlerForModel } from "./handler.js";
import { loadModelCatalog, resolveModelRef, type ModelCatalog } from "./models.js";
import { translateRequest, type ChatCompletionRequest } from "./translate.js";

export interface ProxyServerOptions {
	host?: string;
	port?: number;
	clineDir?: string;
	dataDir?: string;
	providersPath?: string;
	coreVersion?: string;
}

export interface ProxyServer {
	server: Server;
	url: string;
	catalog: ModelCatalog;
	settingsPath: string;
	close: () => Promise<void>;
}

const BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const CORE_VERSION = "0.1.0";

function randomId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
	res.end(text);
}

function sendError(res: ServerResponse, status: number, message: string, code = "invalid_request_error"): void {
	sendJson(res, status, { error: { message, type: status >= 500 ? "server_error" : "invalid_request_error", code } });
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > BODY_LIMIT_BYTES) {
				reject(new ProxyError(413, "Request body too large."));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

interface CompletionContext {
	manager: ProviderSettingsManager;
	catalog: ModelCatalog;
	coreVersion: string;
}

function modelsPayload(catalog: ModelCatalog): unknown {
	return {
		object: "list",
		data: catalog.models.map((model) => ({
			id: model.id,
			object: "model",
			created: Math.floor(Date.now() / 1000),
			owned_by: model.providerId,
		})),
	};
}

async function handleChatCompletions(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: CompletionContext,
): Promise<void> {
	let body: ChatCompletionRequest;
	try {
		body = JSON.parse(await readBody(req)) as ChatCompletionRequest;
	} catch (error) {
		sendError(res, error instanceof ProxyError ? error.status : 400, "Request body must be valid JSON.");
		return;
	}
	if (body.tools !== undefined || body.functions !== undefined || body.tool_choice !== undefined) {
		sendError(res, 400, "Tool calling is not supported by cline-proxy: it runs without tools (no tool loop).");
		return;
	}
	let translated;
	try {
		translated = translateRequest(body);
	} catch (error) {
		sendError(res, 400, error instanceof Error ? error.message : "Invalid request.");
		return;
	}
	let modelRef;
	try {
		modelRef = resolveModelRef(body.model, ctx.catalog);
	} catch (error) {
		sendError(res, 404, error instanceof Error ? error.message : "Unknown model.", "model_not_found");
		return;
	}

	const controller = new AbortController();
	const onClose = (): void => controller.abort();
	req.on("close", onClose);
	let handlerResult;
	try {
		handlerResult = await createHandlerForModel(
			ctx.manager,
			modelRef.providerId,
			modelRef.modelId,
			{ maxOutputTokens: translated.maxOutputTokens, temperature: translated.temperature },
			{ coreVersion: ctx.coreVersion, signal: controller.signal },
		);
	} catch (error) {
		sendError(res, 400, error instanceof Error ? error.message : "Failed to create provider handler.");
		return;
	} finally {
		req.off("close", onClose);
	}

	const completionId = randomId("chatcmpl");
	const created = Math.floor(Date.now() / 1000);
	const openAiModel = `${handlerResult.providerId}/${handlerResult.modelId}`;

	if (!body.stream) {
		let text = "";
		let promptTokens = 0;
		let completionTokens = 0;
		let totalCost: number | undefined;
		try {
			const stream = handlerResult.handler.createMessage(translated.systemPrompt, translated.messages);
			for await (const chunk of stream) {
				if (controller.signal.aborted) {
					break;
				}
				if (chunk.type === "text") {
					text += chunk.text;
				} else if (chunk.type === "usage") {
					promptTokens = chunk.inputTokens;
					completionTokens = chunk.outputTokens;
					totalCost = chunk.totalCost;
				} else if (chunk.type === "done" && !chunk.success && !text) {
					throw new Error(chunk.error ?? "Provider stream failed.");
				}
			}
		} catch (error) {
			if (controller.signal.aborted) {
				return;
			}
			sendError(res, 502, error instanceof Error ? error.message : "Provider request failed.", "provider_error");
			return;
		}
		sendJson(res, 200, {
			id: completionId,
			object: "chat.completion",
			created,
			model: openAiModel,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: text },
					finish_reason: "stop",
				},
			],
			...(promptTokens || completionTokens
				? { usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } }
				: {}),
			...(totalCost !== undefined ? { cost: totalCost } : {}),
		});
		return;
	}

	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const sendChunk = (payload: unknown): void => {
		res.write(`data: ${JSON.stringify(payload)}\n\n`);
	};
	const baseChunk = (): Record<string, unknown> => ({
		id: completionId,
		object: "chat.completion.chunk",
		created,
		model: openAiModel,
	});
	const clientClosed = new Promise<void>((resolve) => req.on("close", resolve));
	try {
		sendChunk({ ...baseChunk(), choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
		const stream = handlerResult.handler.createMessage(translated.systemPrompt, translated.messages);
		let usage: { promptTokens: number; completionTokens: number } | undefined;
		let failed: string | undefined;
		const consume = (async (): Promise<void> => {
			for await (const chunk of stream) {
				if (controller.signal.aborted) {
					break;
				}
				if (chunk.type === "text" && chunk.text) {
					sendChunk({
						...baseChunk(),
						choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }],
					});
				} else if (chunk.type === "usage") {
					usage = { promptTokens: chunk.inputTokens, completionTokens: chunk.outputTokens };
				} else if (chunk.type === "done" && !chunk.success) {
					failed = chunk.error ?? "Provider stream failed.";
				}
			}
		})();
		await Promise.race([consume, clientClosed]);
		if (controller.signal.aborted) {
			res.destroy();
			return;
		}
		await consume;
		if (failed) {
			sendChunk({
				...baseChunk(),
				choices: [{ index: 0, delta: {}, finish_reason: "error" }],
				error: { message: failed },
			});
		} else {
			const includeUsage = body.stream_options?.include_usage === true;
			sendChunk({
				...baseChunk(),
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				...(includeUsage && usage
					? {
							usage: {
								prompt_tokens: usage.promptTokens,
								completion_tokens: usage.completionTokens,
								total_tokens: usage.promptTokens + usage.completionTokens,
							},
						}
					: {}),
			});
		}
		res.write("data: [DONE]\n\n");
		res.end();
	} catch {
		if (!res.writableEnded) {
			res.destroy();
		}
	}
}

/** Start the OpenAI-compatible HTTP server. */
export async function startProxyServer(options: ProxyServerOptions = {}): Promise<ProxyServer> {
	const install = detectClineInstall({
		clineDir: options.clineDir,
		dataDir: options.dataDir,
		providersPath: options.providersPath,
	});
	if (!install.providersFileExists) {
		throw new Error(
			`No Cline provider settings found at ${install.providersPath}. Run \`cline auth\` first, or point CLINE_PROVIDER_SETTINGS_PATH at your providers.json.`,
		);
	}
	const manager = new ProviderSettingsManager({ filePath: install.providersPath });
	const catalog = await loadModelCatalog(manager);
	if (catalog.models.length === 0) {
		throw new Error(
			`No usable providers in ${install.providersPath}. Configure a provider in Cline first (e.g. \`cline auth\`).`,
		);
	}
	const coreVersion = options.coreVersion ?? CORE_VERSION;
	const ctx: CompletionContext = { manager, catalog, coreVersion };

	const server = createServer((req, res) => {
		void (async (): Promise<void> => {
			try {
				const url = new URL(req.url ?? "/", "http://localhost");
				if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/v1/models/")) {
					sendJson(res, 200, modelsPayload(catalog));
					return;
				}
				if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
					await handleChatCompletions(req, res, ctx);
					return;
				}
				if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
					sendJson(res, 200, {
						status: "ok",
						service: "cline-proxy",
						models: catalog.models.length,
						defaultModel: catalog.defaultModel,
						settingsPath: install.providersPath,
					});
					return;
				}
				sendError(res, 404, `Not found: ${req.method} ${url.pathname}`, "not_found");
			} catch (error) {
				if (!res.writableEnded) {
					sendError(res, 500, error instanceof Error ? error.message : "Internal server error.");
				}
			}
		})();
	});

	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 18789;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		server,
		url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
		catalog,
		settingsPath: install.providersPath,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}
