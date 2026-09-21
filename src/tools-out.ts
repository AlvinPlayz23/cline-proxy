import type { ApiStreamChunk } from "@cline/llms";

type ToolCallsChunk = Extract<ApiStreamChunk, { type: "tool_calls" }>;

export interface OpenAIToolCallOut {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

function argsToString(args: string | Record<string, unknown> | undefined): string {
	if (args === undefined) {
		return "{}";
	}
	if (typeof args === "string") {
		return args;
	}
	try {
		return JSON.stringify(args);
	} catch {
		return "{}";
	}
}

/** Normalize one provider `tool_calls` chunk into an OpenAI tool_call entry. */
export function toOpenAIToolCall(chunk: ToolCallsChunk, fallbackId: string): OpenAIToolCallOut {
	const callId = chunk.tool_call.call_id ?? chunk.tool_call.function.id ?? fallbackId;
	const name = chunk.tool_call.function.name ?? "tool";
	return {
		id: callId,
		type: "function",
		function: { name, arguments: argsToString(chunk.tool_call.function.arguments) },
	};
}
