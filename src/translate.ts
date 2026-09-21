import type { ContentBlock, Message, ToolDefinition, ToolResultContent } from "@cline/shared";

export interface OpenAIContentPart {
	type?: string;
	text?: string;
	image_url?: { url?: string };
	input_text?: string;
}

export interface OpenAIFunctionDefinition {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

export interface OpenAITool {
	type?: string;
	function?: OpenAIFunctionDefinition;
}

export interface OpenAIToolCall {
	id?: string;
	type?: string;
	function?: { name?: string; arguments?: string | Record<string, unknown> };
}

export type OpenAIToolChoice = string | { type?: string; function?: { name?: string } };

export interface OpenAIMessage {
	role: string;
	content?: string | OpenAIContentPart[] | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: OpenAIToolCall[];
	function_call?: { name?: string; arguments?: string | Record<string, unknown> };
}

export interface ChatCompletionRequest {
	model?: string;
	messages: OpenAIMessage[];
	system?: string;
	tools?: OpenAITool[];
	functions?: OpenAIFunctionDefinition[];
	tool_choice?: OpenAIToolChoice;
	max_tokens?: number;
	max_completion_tokens?: number;
	temperature?: number;
	stream?: boolean;
	stream_options?: { include_usage?: boolean };
	[key: string]: unknown;
}

export interface TranslatedPrompt {
	systemPrompt: string;
	messages: Message[];
	tools?: ToolDefinition[];
	maxOutputTokens?: number;
	temperature?: number;
}

function partText(part: OpenAIContentPart): string | undefined {
	if (typeof part.text === "string") {
		return part.text;
	}
	if (typeof part.input_text === "string") {
		return part.input_text;
	}
	return undefined;
}

function parseImageUrl(url: string): { data: string; mediaType: string } | undefined {
	const match = url.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s);
	if (!match) {
		return undefined;
	}
	return { mediaType: match[1], data: match[2] };
}

/** Convert an OpenAI content value to Cline content blocks. */
export function toContentBlocks(content: OpenAIMessage["content"]): ContentBlock[] {
	if (content == null) {
		return [{ type: "text", text: "" }];
	}
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	const blocks: ContentBlock[] = [];
	for (const part of content) {
		if (part.type === "image_url" || part.image_url?.url) {
			const url = part.image_url?.url ?? "";
			const parsed = parseImageUrl(url);
			if (parsed) {
				blocks.push({ type: "image", data: parsed.data, mediaType: parsed.mediaType });
			} else if (url) {
				blocks.push({ type: "text", text: `[image: ${url}]` });
			}
			continue;
		}
		const text = partText(part);
		if (text !== undefined) {
			blocks.push({ type: "text", text });
		}
	}
	if (blocks.length === 0) {
		blocks.push({ type: "text", text: "" });
	}
	return blocks;
}

function textOf(blocks: ContentBlock[]): string {
	return blocks
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

/**
 * Convert OpenAI `tools` (and legacy `functions`) to Cline tool definitions.
 * `tool_choice: "none"` disables tools; any other choice behaves like "auto"
 * (the provider layer has no forced-tool mode, so naming a specific tool in
 * `tool_choice` is accepted but not enforced).
 */
export function toToolDefinitions(body: ChatCompletionRequest): ToolDefinition[] | undefined {
	if (body.tool_choice === "none") {
		return undefined;
	}
	if (body.tools !== undefined && !Array.isArray(body.tools)) {
		throw new Error('`tools` must be an array of { type: "function", function: { name, ... } }.');
	}
	if (body.functions !== undefined && !Array.isArray(body.functions)) {
		throw new Error("`functions` must be an array of { name, parameters }.");
	}
	const out: ToolDefinition[] = [];
	for (const tool of body.tools ?? []) {
		const fn = tool?.function;
		if (!fn || typeof fn.name !== "string" || !fn.name.trim()) {
			continue;
		}
		out.push({
			name: fn.name.trim(),
			description: typeof fn.description === "string" ? fn.description : "",
			inputSchema: asRecord(fn.parameters) ?? { type: "object" },
		});
	}
	for (const fn of body.functions ?? []) {
		if (!fn || typeof fn.name !== "string" || !fn.name.trim()) {
			continue;
		}
		out.push({
			name: fn.name.trim(),
			description: typeof fn.description === "string" ? fn.description : "",
			inputSchema: asRecord(fn.parameters) ?? { type: "object" },
		});
	}
	return out.length > 0 ? out : undefined;
}

/** Parse assistant tool-call arguments (a JSON string or an already-parsed object). */
function parseToolArguments(raw: string | Record<string, unknown> | undefined, name: string): Record<string, unknown> {
	if (raw === undefined) {
		return {};
	}
	if (typeof raw !== "string") {
		return raw;
	}
	if (!raw.trim()) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Tool call for ${JSON.stringify(name)} has arguments that are not valid JSON.`);
	}
	const record = asRecord(parsed);
	if (!record) {
		throw new Error(`Tool call for ${JSON.stringify(name)} arguments must be a JSON object.`);
	}
	return record;
}

/** Convert an assistant message, mapping `tool_calls` to `tool_use` content blocks. */
function toAssistantMessage(msg: OpenAIMessage, tag: string): Message {
	if (msg.function_call !== undefined) {
		throw new Error("Legacy `function_call` is not supported: send `tool_calls` instead.");
	}
	const blocks = toContentBlocks(msg.content ?? null);
	const calls = msg.tool_calls ?? [];
	if (!Array.isArray(calls)) {
		throw new Error("Assistant `tool_calls` must be an array.");
	}
	if (calls.length > 0 && blocks.length === 1 && blocks[0].type === "text" && blocks[0].text === "") {
		blocks.pop();
	}
	calls.forEach((call, index) => {
		const fn = call?.function;
		const name = fn?.name?.trim();
		if (!name) {
			throw new Error("Assistant `tool_calls` entries must include a function `name`.");
		}
		blocks.push({
			type: "tool_use",
			id: call?.id?.trim() || `${tag}-${index}`,
			name,
			input: parseToolArguments(fn?.arguments, name),
		});
	});
	if (blocks.length === 0) {
		blocks.push({ type: "text", text: "" });
	}
	return { role: "assistant", content: blocks };
}

/**
 * Convert a `tool` message to a Cline `tool_result` block. Cline messages only
 * support user/assistant roles, so results ride as user messages (the same
 * shape the provider layer itself round-trips).
 */
function toToolResultMessage(msg: OpenAIMessage, toolNames: Map<string, string>): Message {
	const id = msg.tool_call_id?.trim();
	if (!id) {
		throw new Error("`tool` messages must include a `tool_call_id`.");
	}
	const result: ToolResultContent = {
		type: "tool_result",
		tool_use_id: id,
		name: msg.name?.trim() || toolNames.get(id) || "tool",
		content: textOf(toContentBlocks(msg.content)),
	};
	return { role: "user", content: [result] };
}

/**
 * Split an OpenAI chat request into a Cline system prompt + message history.
 * `system`/`developer` messages and a top-level `system` string all fold into
 * the system prompt (Cline messages only support user/assistant roles).
 * `tools`/`functions` become Cline tool definitions passed to the provider.
 * The client owns the tool loop (executing tools and sending back `tool`
 * messages); the proxy itself never executes tools.
 */
export function translateRequest(body: ChatCompletionRequest): TranslatedPrompt {
	if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
		throw new Error("Request body must include a non-empty `messages` array.");
	}
	const systemParts: string[] = [];
	if (typeof body.system === "string" && body.system.trim()) {
		systemParts.push(body.system.trim());
	}
	const messages: Message[] = [];
	const toolNames = new Map<string, string>();
	body.messages.forEach((msg, messageIndex) => {
		const role = msg.role;
		if (role === "system" || role === "developer") {
			const text = textOf(toContentBlocks(msg.content));
			if (text.trim()) {
				systemParts.push(text.trim());
			}
			return;
		}
		if (role === "tool") {
			messages.push(toToolResultMessage(msg, toolNames));
			return;
		}
		if (role === "function") {
			throw new Error("`function` messages are not supported: send `tool` messages with `tool_call_id` instead.");
		}
		if (role === "assistant") {
			const message = toAssistantMessage(msg, `call_m${messageIndex}`);
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "tool_use") {
						toolNames.set(block.id, block.name);
					}
				}
			}
			messages.push(message);
			return;
		}
		if (role !== "user") {
			throw new Error(`Unsupported message role ${JSON.stringify(role)}.`);
		}
		messages.push({ role, content: toContentBlocks(msg.content) });
	});
	if (messages.length === 0) {
		throw new Error("Request must include at least one user or assistant message.");
	}
	const tools = toToolDefinitions(body);
	const maxTokens = body.max_completion_tokens ?? body.max_tokens;
	return {
		systemPrompt: systemParts.join("\n\n"),
		messages,
		...(tools ? { tools } : {}),
		...(typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
			? { maxOutputTokens: Math.floor(maxTokens) }
			: {}),
		...(typeof body.temperature === "number" && Number.isFinite(body.temperature)
			? { temperature: body.temperature }
			: {}),
	};
}
