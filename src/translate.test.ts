import { describe, expect, test } from "bun:test";
import { toContentBlocks, translateRequest } from "./translate.js";

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

	test("rejects tool messages (no tool loop)", () => {
		expect(() =>
			translateRequest({
				messages: [
					{ role: "user", content: "Hi" },
					{ role: "tool", content: "result", tool_call_id: "1" },
				],
			}),
		).toThrow();
	});

	test("rejects empty message lists", () => {
		expect(() => translateRequest({ messages: [] })).toThrow();
		expect(() => translateRequest({ messages: [{ role: "system", content: "x" }] })).toThrow();
	});
});
