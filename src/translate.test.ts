import { describe, expect, test } from "bun:test";
import { toContentBlocks, toToolDefinitions, translateRequest } from "./translate.js";

describe("toContentBlocks", () => {
	test("passes plain strings through", () => {
		expect(toContentBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
	});

	test("converts base64 image parts", () => {
		const blocks = toContentBlocks([
			{ type: "text", text: "look" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,abcd" } },
		]);
		expect(blocks).toEqual([
			{ type: "text", text: "look" },
			{ type: "image", data: "abcd", mediaType: "image/png" },
		]);
	});
});

describe("translateRequest", () => {
	test("folds system messages into the system prompt", () => {
		const out = translateRequest({
			model: "anthropic/claude-sonnet-5",
			messages: [
				{ role: "system", content: "Be terse." },
				{ role: "user", content: "Hi" },
			],
		});
		expect(out.systemPrompt).toBe("Be terse.");
		expect(out.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
		expect(out.tools).toBeUndefined();
	});

	test("maps max_completion_tokens and temperature", () => {
		const out = translateRequest({
			messages: [{ role: "user", content: "Hi" }],
			max_completion_tokens: 128,
			temperature: 0.2,
		});
		expect(out.maxOutputTokens).toBe(128);
		expect(out.temperature).toBe(0.2);
	});

	test("converts tools to Cline tool definitions", () => {
		const out = translateRequest({
			messages: [{ role: "user", content: "Hi" }],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get the weather",
						parameters: { type: "object", properties: { city: { type: "string" } } },
					},
				},
			],
		});
		expect(out.tools).toEqual([
			{
				name: "get_weather",
				description: "Get the weather",
				inputSchema: { type: "object", properties: { city: { type: "string" } } },
			},
		]);
	});

	test("tool_choice none disables tools", () => {
		expect(
			toToolDefinitions({
				messages: [],
				tools: [{ type: "function", function: { name: "x" } }],
				tool_choice: "none",
			}),
		).toBeUndefined();
	});

	test("maps assistant tool_calls to tool_use blocks", () => {
		const out = translateRequest({
			messages: [
				{ role: "user", content: "What is the weather?" },
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
				},
			],
		});
		expect(out.messages[1]).toEqual({
			role: "assistant",
			content: [{ type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } }],
		});
	});

	test("maps tool messages to tool_result blocks", () => {
		const out = translateRequest({
			messages: [
				{ role: "user", content: "Weather?" },
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_1", function: { name: "get_weather", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "call_1", content: "sunny" },
			],
		});
		expect(out.messages[2]).toEqual({
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "call_1", name: "get_weather", content: "sunny" }],
		});
	});

	test("rejects tool messages without tool_call_id", () => {
		expect(() =>
			translateRequest({
				messages: [
					{ role: "user", content: "Hi" },
					{ role: "tool", content: "result" },
				],
			}),
		).toThrow();
	});

	test("rejects invalid tool call arguments", () => {
		expect(() =>
			translateRequest({
				messages: [
					{
						role: "assistant",
						content: null,
						tool_calls: [{ id: "call_1", function: { name: "x", arguments: "not-json" } }],
					},
				],
			}),
		).toThrow();
	});

	test("rejects legacy function_call and function messages", () => {
		expect(() =>
			translateRequest({
				messages: [{ role: "assistant", content: "x", function_call: { name: "x", arguments: "{}" } }],
			}),
		).toThrow();
		expect(() =>
			translateRequest({
				messages: [
					{ role: "user", content: "Hi" },
					{ role: "function", name: "x", content: "result" },
				],
			}),
		).toThrow();
	});

	test("rejects empty message lists", () => {
		expect(() => translateRequest({ messages: [] })).toThrow();
		expect(() => translateRequest({ messages: [{ role: "system", content: "x" }] })).toThrow();
	});
});
