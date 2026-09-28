import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname } from "node:path";
import type { ApiStreamChunk } from "@cline/llms";

export type LogStatus = "pending" | "ok" | "error" | "aborted";

export interface LogChunk {
	t: number;
	type: string;
	[key: string]: unknown;
}

export interface LogUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	thoughtsTokenCount?: number;
}

export interface LogToolCall {
	id?: string;
	name: string;
	arguments: unknown;
}

export interface LogEntry {
	id: string;
	seq: number;
	createdAt: number;
	finishedAt?: number;
	status: LogStatus;
	httpStatus?: number;
	endpoint: string;
	stream: boolean;
	requestedModel?: string;
	providerId?: string;
	modelId?: string;
	preview: string;
	messageCount: number;
	toolCount: number;
	client: { ip?: string; headers: Record<string, string> };
	/** The client's request body as received (images elided). */
	request: unknown;
	/** What was handed to the Cline provider layer. */
	translated?: unknown;
	/** Every chunk the provider stream produced. */
	chunks: LogChunk[];
	chunksTruncated: boolean;
	/** Exact payloads written back to the client. */
	sent: string[];
	response: {
		text: string;
		reasoning: string;
		toolCalls: LogToolCall[];
		finishReason?: string;
		usage?: LogUsage;
		cost?: number;
		error?: string;
	};
}

export interface LogSummary {
	id: string;
	seq: number;
	createdAt: number;
	durationMs?: number;
	status: LogStatus;
	httpStatus?: number;
	stream: boolean;
	requestedModel?: string;
	providerId?: string;
	modelId?: string;
	preview: string;
	messageCount: number;
	toolCount: number;
	usage?: LogUsage;
	cost?: number;
	error?: string;
	toolCalls: number;
}

export type LogEvent = { type: "upsert"; summary: LogSummary } | { type: "clear" };

const MAX_CHUNKS = 5000;
const MAX_SENT = 5000;
const EMIT_INTERVAL_MS = 150;
const REDACTED_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "cookie", "api-key"]);
const DATA_URL = /^data:[^;,]+(;[^,]*)?,/;

/** Deep-copy a JSON value, eliding inline base64 payloads that would drown the log. */
export function sanitizeForLog(value: unknown): unknown {
	if (typeof value === "string") {
		if (value.length > 256 && DATA_URL.test(value)) {
			const head = value.slice(0, value.indexOf(",") + 1);
			return `${head}[${value.length - head.length} chars omitted]`;
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeForLog(item));
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(record)) {
			out[key] =
				key === "data" && record.type === "image" && typeof item === "string" && item.length > 256
					? `[${item.length} chars of base64 omitted]`
					: sanitizeForLog(item);
		}
		return out;
	}
	return value;
}

function partsText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) => {
			const record = part as { text?: unknown; input_text?: unknown };
			return typeof record?.text === "string" ? record.text : typeof record?.input_text === "string" ? record.input_text : "";
		})
		.join("");
}

function describeRequest(body: unknown): { preview: string; messageCount: number; toolCount: number } {
	const record = body as { messages?: unknown; tools?: unknown; functions?: unknown } | null;
	const messages = Array.isArray(record?.messages) ? (record.messages as Array<{ role?: string; content?: unknown }>) : [];
	let preview = "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const role = messages[i]?.role;
		if (role === "user" || role === "tool") {
			preview = partsText(messages[i]?.content).trim();
			if (preview) {
				break;
			}
		}
	}
	const toolCount =
		(Array.isArray(record?.tools) ? record.tools.length : 0) + (Array.isArray(record?.functions) ? record.functions.length : 0);
	return { preview: preview.replace(/\s+/g, " ").slice(0, 160), messageCount: messages.length, toolCount };
}

function redactHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) {
			continue;
		}
		out[name] = REDACTED_HEADERS.has(name.toLowerCase()) ? "[redacted]" : Array.isArray(value) ? value.join(", ") : value;
	}
	return out;
}

export interface LogStoreOptions {
	/** Max entries kept (oldest dropped). Default 200. */
	limit?: number;
	/** Optional JSONL file: finished entries are appended and reloaded on start. */
	filePath?: string;
}

export class LogStore {
	private readonly limit: number;
	private readonly filePath?: string;
	private entries: LogEntry[] = [];
	private readonly byId = new Map<string, LogEntry>();
	private readonly listeners = new Set<(event: LogEvent) => void>();
	private readonly lastEmit = new WeakMap<LogEntry, number>();
	private seq = 0;

	constructor(options: LogStoreOptions = {}) {
		this.limit = Math.max(1, options.limit ?? 200);
		this.filePath = options.filePath;
		this.load();
	}

	begin(init: { req: IncomingMessage; endpoint: string; request: unknown; stream: boolean; requestedModel?: string }): LogEntry {
		const { preview, messageCount, toolCount } = describeRequest(init.request);
		const entry: LogEntry = {
			id: `${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
			seq: this.seq,
			createdAt: Date.now(),
			status: "pending",
			endpoint: init.endpoint,
			stream: init.stream,
			...(init.requestedModel ? { requestedModel: init.requestedModel } : {}),
			preview,
			messageCount,
			toolCount,
			client: { ip: init.req.socket.remoteAddress, headers: redactHeaders(init.req.headers) },
			request: sanitizeForLog(init.request),
			chunks: [],
			chunksTruncated: false,
			sent: [],
			response: { text: "", reasoning: "", toolCalls: [] },
		};
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		while (this.entries.length > this.limit) {
			const dropped = this.entries.shift();
			if (dropped) {
				this.byId.delete(dropped.id);
			}
		}
		this.emit({ type: "upsert", summary: this.summary(entry) });
		return entry;
	}

	patch(entry: LogEntry, fields: { providerId?: string; modelId?: string; translated?: unknown }): void {
		if (fields.providerId !== undefined) {
			entry.providerId = fields.providerId;
		}
		if (fields.modelId !== undefined) {
			entry.modelId = fields.modelId;
		}
		if (fields.translated !== undefined) {
			entry.translated = sanitizeForLog(fields.translated);
		}
		this.touch(entry);
	}

	recordChunk(entry: LogEntry, chunk: ApiStreamChunk): void {
		const t = Date.now() - entry.createdAt;
		const response = entry.response;
		let logged: LogChunk;
		switch (chunk.type) {
			case "text":
				response.text += chunk.text;
				logged = { t, type: "text", text: chunk.text };
				break;
			case "reasoning":
				response.reasoning += chunk.reasoning;
				logged = { t, type: "reasoning", reasoning: chunk.reasoning };
				break;
			case "tool_calls": {
				const fn = chunk.tool_call.function;
				const id = chunk.tool_call.call_id ?? fn.id;
				response.toolCalls.push({ ...(id ? { id } : {}), name: fn.name, arguments: fn.arguments });
				logged = { t, type: "tool_calls", ...(id ? { id } : {}), name: fn.name, arguments: fn.arguments };
				break;
			}
			case "usage": {
				response.usage = {
					inputTokens: chunk.inputTokens,
					outputTokens: chunk.outputTokens,
					...(chunk.cacheReadTokens !== undefined ? { cacheReadTokens: chunk.cacheReadTokens } : {}),
					...(chunk.cacheWriteTokens !== undefined ? { cacheWriteTokens: chunk.cacheWriteTokens } : {}),
					...(chunk.thoughtsTokenCount !== undefined ? { thoughtsTokenCount: chunk.thoughtsTokenCount } : {}),
				};
				if (chunk.totalCost !== undefined) {
					response.cost = chunk.totalCost;
				}
				logged = { t, type: "usage", ...response.usage, ...(chunk.totalCost !== undefined ? { totalCost: chunk.totalCost } : {}) };
				break;
			}
			case "done":
				if (!chunk.success) {
					response.error = chunk.error ?? "Provider stream failed.";
				}
				logged = {
					t,
					type: "done",
					success: chunk.success,
					...(chunk.error ? { error: chunk.error } : {}),
					...(chunk.incompleteReason ? { incompleteReason: chunk.incompleteReason } : {}),
				};
				break;
			default:
				logged = { t, type: (chunk as { type: string }).type, note: "payload omitted" };
		}
		if (entry.chunks.length < MAX_CHUNKS) {
			entry.chunks.push(logged);
		} else {
			entry.chunksTruncated = true;
		}
		this.touch(entry);
	}

	recordSent(entry: LogEntry, payload: string): void {
		if (entry.sent.length < MAX_SENT) {
			entry.sent.push(payload);
		}
	}

	finish(
		entry: LogEntry,
		result: { status: Exclude<LogStatus, "pending">; httpStatus?: number; error?: string; finishReason?: string },
	): void {
		if (entry.status !== "pending") {
			return;
		}
		entry.status = result.status;
		entry.finishedAt = Date.now();
		if (result.httpStatus !== undefined) {
			entry.httpStatus = result.httpStatus;
		}
		if (result.error) {
			entry.response.error = result.error;
		}
		if (result.finishReason) {
			entry.response.finishReason = result.finishReason;
		}
		this.emit({ type: "upsert", summary: this.summary(entry) });
		this.persist(entry);
	}

	summary(entry: LogEntry): LogSummary {
		return {
			id: entry.id,
			seq: entry.seq,
			createdAt: entry.createdAt,
			...(entry.finishedAt !== undefined ? { durationMs: entry.finishedAt - entry.createdAt } : {}),
			status: entry.status,
			...(entry.httpStatus !== undefined ? { httpStatus: entry.httpStatus } : {}),
			stream: entry.stream,
			...(entry.requestedModel ? { requestedModel: entry.requestedModel } : {}),
			...(entry.providerId ? { providerId: entry.providerId } : {}),
			...(entry.modelId ? { modelId: entry.modelId } : {}),
			preview: entry.preview,
			messageCount: entry.messageCount,
			toolCount: entry.toolCount,
			...(entry.response.usage ? { usage: entry.response.usage } : {}),
			...(entry.response.cost !== undefined ? { cost: entry.response.cost } : {}),
			...(entry.response.error ? { error: entry.response.error } : {}),
			toolCalls: entry.response.toolCalls.length,
		};
	}

	/** Summaries, newest first. */
	list(): LogSummary[] {
		return this.entries.map((entry) => this.summary(entry)).reverse();
	}

	get(id: string): LogEntry | undefined {
		return this.byId.get(id);
	}

	clear(): void {
		this.entries = [];
		this.byId.clear();
		if (this.filePath) {
			try {
				writeFileSync(this.filePath, "");
			} catch {
				// best-effort persistence
			}
		}
		this.emit({ type: "clear" });
	}

	subscribe(listener: (event: LogEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private touch(entry: LogEntry): void {
		const now = Date.now();
		if (now - (this.lastEmit.get(entry) ?? 0) < EMIT_INTERVAL_MS) {
			return;
		}
		this.emit({ type: "upsert", summary: this.summary(entry) });
	}

	private emit(event: LogEvent): void {
		if (event.type === "upsert") {
			const entry = this.byId.get(event.summary.id);
			if (entry) {
				this.lastEmit.set(entry, Date.now());
			}
		}
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// a broken subscriber must not affect request handling
			}
		}
	}

	private persist(entry: LogEntry): void {
		if (!this.filePath) {
			return;
		}
		try {
			appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
		} catch {
			// best-effort persistence
		}
	}

	private load(): void {
		if (!this.filePath) {
			return;
		}
		try {
			mkdirSync(dirname(this.filePath), { recursive: true });
			if (!existsSync(this.filePath)) {
				return;
			}
			const lines = readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
			const kept = lines.slice(-this.limit);
			for (const line of kept) {
				try {
					const entry = JSON.parse(line) as LogEntry;
					entry.seq = ++this.seq;
					this.entries.push(entry);
					this.byId.set(entry.id, entry);
				} catch {
					// skip corrupt lines
				}
			}
			if (lines.length > this.limit * 2) {
				writeFileSync(this.filePath, kept.join("\n") + "\n");
			}
		} catch {
			// best-effort persistence
		}
	}
}
