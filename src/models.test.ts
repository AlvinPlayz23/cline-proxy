import { describe, expect, test } from "bun:test";
import { resolveModelRef, splitModelRef } from "./models.js";

const catalog = {
	models: [
		{ id: "anthropic/claude-sonnet-5", providerId: "anthropic", modelId: "claude-sonnet-5", name: "Claude Sonnet 5" },
		{ id: "ollama/llama3.1", providerId: "ollama", modelId: "llama3.1", name: "Llama 3.1" },
	],
	defaultModel: "anthropic/claude-sonnet-5",
};

describe("splitModelRef", () => {
	test("splits on the first slash", () => {
		expect(splitModelRef("anthropic/claude-sonnet-5")).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-5",
		});
	});

	test("rejects bare ids", () => {
		expect(() => splitModelRef("claude-sonnet-5")).toThrow();
	});
});

describe("resolveModelRef", () => {
	test("resolves providerId/model-slug directly", () => {
		expect(resolveModelRef("ollama/llama3.1", catalog)).toEqual({
			providerId: "ollama",
			modelId: "llama3.1",
		});
	});

	test("falls back to the Cline default model", () => {
		expect(resolveModelRef(undefined, catalog)).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-5",
		});
	});

	test("rejects unknown bare ids", () => {
		expect(() => resolveModelRef("nope", { models: [], defaultModel: undefined })).toThrow();
	});
});
