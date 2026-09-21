import { describe, expect, test } from "bun:test";
import type { ApiStreamChunk } from "@cline/llms";
import { toOpenAIToolCall } from "./tools-out.js";

type ToolCallsChunk = Extract<ApiStreamChunk, { type: "tool_calls" }>;

function chunk(args: unknown, callId = "call_1", name = "get_weather"): ToolCallsChunk {
	return {
		type: "tool_calls",
		id: "chunk-1",
		tool_call: { call_id: callId, function: { id: callId, name, arguments: args as string } },
	};
}

describe("toOpenAIToolCall", () => {
	test("passes string arguments through", () => {
		expect(toOpenAIToolCall(chunk('{"city":"Paris"}'), "fallback")).toEqual({
			id: "call_1",
			type: "function",
			function: { name: "get_weather", arguments: '{"city":"Paris"}' },
		});
	});

	test("serializes object arguments", () => {
		expect(toOpenAIToolCall(chunk({ city: "Paris" }), "fallback")).toEqual({
			id: "call_1",
			type: "function",
			function: { name: "get_weather", arguments: '{"city":"Paris"}' },
		});
	});

	test("falls back to generated id", () => {
		const fallback: ToolCallsChunk = {
			type: "tool_calls",
			id: "chunk-1",
			tool_call: { function: { name: "x", arguments: "{}" } },
		};
		expect(toOpenAIToolCall(fallback, "call_9").id).toBe("call_9");
	});
});
