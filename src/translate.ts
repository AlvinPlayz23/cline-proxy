import type { ContentBlock, Message } from "@cline/shared";

export interface OpenAIContentPart {
	type?: string;
	text?: string;
	image_url?: { url?: string };
	input_text?: string;
}

export interface OpenAIMessage {
	role: string;
	content?: string | OpenAIContentPart[] | null;
	name?: string;
	tool_call_id?: string;
}

export interface ChatCompletionRequest {
	model?: string;
	messages: OpenAIMessage[];
	system?: string;
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

/**
 * Split an OpenAI chat request into a Cline system prompt + message history.
 * `system`/`developer` messages and a top-level `system` string all fold into
 * the system prompt (Cline messages only support user/assistant roles).
 * `tools`/`functions` are deliberately ignored: this proxy performs pure
 * text completion with no tool loop.
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
	for (const msg of body.messages) {
		const role = msg.role;
		if (role === "system" || role === "developer") {
			const blocks = toContentBlocks(msg.content);
			const text = blocks
				.filter((block): block is { type: "text"; text: string } => block.type === "text")
				.map((block) => block.text)
				.join("");
			if (text.trim()) {
				systemParts.push(text.trim());
			}
			continue;
		}
		if (role === "tool" || role === "function") {
			throw new Error(
				"`tool`/`function` messages are not supported: this proxy runs without tools (no tool loop).",
			);
		}
		if (role !== "user" && role !== "assistant") {
			throw new Error(`Unsupported message role ${JSON.stringify(role)}.`);
		}
		messages.push({ role, content: toContentBlocks(msg.content) });
	}
	if (messages.length === 0) {
		throw new Error("Request must include at least one user or assistant message.");
	}
	const maxTokens = body.max_completion_tokens ?? body.max_tokens;
	return {
		systemPrompt: systemParts.join("\n\n"),
		messages,
		...(typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
			? { maxOutputTokens: Math.floor(maxTokens) }
			: {}),
		...(typeof body.temperature === "number" && Number.isFinite(body.temperature)
			? { temperature: body.temperature }
			: {}),
	};
}
