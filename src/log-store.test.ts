import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogStore, sanitizeForLog, type LogEvent } from "./log-store.js";

function fakeReq(headers: Record<string, string> = {}): IncomingMessage {
	return { headers, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
}

const body = {
	model: "deepseek/deepseek-v4-flash",
	messages: [
		{ role: "system", content: "be brief" },
		{ role: "user", content: [{ type: "text", text: "hello   there\nfriend" }] },
	],
	tools: [{ type: "function", function: { name: "f" } }],
};

function begin(store: LogStore, request: unknown = body) {
	return store.begin({ req: fakeReq({ authorization: "Bearer sk-secret", "user-agent": "t" }), endpoint: "/v1/chat/completions", request, stream: true });
}

describe("sanitizeForLog", () => {
	test("elides base64 data URLs and image block data but keeps short strings", () => {
		const big = `data:image/png;base64,${"A".repeat(500)}`;
		const out = sanitizeForLog({
			a: big,
			b: [{ type: "image", data: "B".repeat(400), mediaType: "image/png" }],
			c: "data:short",
		}) as { a: string; b: Array<{ data: string; mediaType: string }>; c: string };
		expect(out.a).toBe("data:image/png;base64,[500 chars omitted]");
		expect(out.b[0]?.data).toContain("400 chars of base64 omitted");
		expect(out.b[0]?.mediaType).toBe("image/png");
		expect(out.c).toBe("data:short");
	});
});

describe("LogStore", () => {
	test("records request summary, redacts secrets and never mutates the input", () => {
		const store = new LogStore();
		const entry = begin(store);
		expect(entry.preview).toBe("hello there friend");
		expect(entry.messageCount).toBe(2);
		expect(entry.toolCount).toBe(1);
		expect(entry.client.headers.authorization).toBe("[redacted]");
		expect(entry.client.headers["user-agent"]).toBe("t");
		expect(JSON.stringify(entry)).not.toContain("sk-secret");
	});

	test("aggregates chunks into the response and emits events", () => {
		const store = new LogStore();
		const events: LogEvent[] = [];
		store.subscribe((event) => events.push(event));
		const entry = begin(store);
		store.recordChunk(entry, { type: "reasoning", reasoning: "hm", id: "1" });
		store.recordChunk(entry, { type: "text", text: "Hel", id: "1" });
		store.recordChunk(entry, { type: "text", text: "lo", id: "1" });
		store.recordChunk(entry, { type: "tool_calls", id: "1", tool_call: { call_id: "c1", function: { name: "f", arguments: { x: 1 } } } } as never);
		store.recordChunk(entry, { type: "usage", inputTokens: 3, outputTokens: 4, totalCost: 0.5, id: "1" });
		store.recordChunk(entry, { type: "done", success: false, error: "boom", id: "1" });
		store.finish(entry, { status: "error", httpStatus: 200, error: "boom", finishReason: "error" });
		expect(entry.response.text).toBe("Hello");
		expect(entry.response.reasoning).toBe("hm");
		expect(entry.response.toolCalls).toEqual([{ id: "c1", name: "f", arguments: { x: 1 } }]);
		expect(entry.response.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
		expect(entry.response.cost).toBe(0.5);
		expect(entry.chunks.map((chunk) => chunk.type)).toEqual(["reasoning", "text", "text", "tool_calls", "usage", "done"]);
		const last = events.at(-1);
		expect(last?.type === "upsert" && last.summary.status).toBe("error");
		expect(store.summary(entry).toolCalls).toBe(1);
	});

	test("finish is idempotent", () => {
		const store = new LogStore();
		const entry = begin(store);
		store.finish(entry, { status: "aborted" });
		store.finish(entry, { status: "ok", httpStatus: 200 });
		expect(entry.status).toBe("aborted");
	});

	test("keeps only the newest `limit` entries, newest first", () => {
		const store = new LogStore({ limit: 2 });
		const first = begin(store);
		begin(store);
		const third = begin(store);
		expect(store.get(first.id)).toBeUndefined();
		expect(store.list()[0]?.id).toBe(third.id);
		expect(store.list()).toHaveLength(2);
	});

	test("clear empties the store and notifies subscribers", () => {
		const store = new LogStore();
		const events: LogEvent[] = [];
		store.subscribe((event) => events.push(event));
		begin(store);
		store.clear();
		expect(store.list()).toHaveLength(0);
		expect(events.at(-1)).toEqual({ type: "clear" });
	});

	test("persists finished entries to a JSONL file and reloads them", () => {
		const filePath = join(mkdtempSync(join(tmpdir(), "cline-proxy-log-")), "logs.jsonl");
		const store = new LogStore({ filePath });
		const entry = begin(store);
		store.recordChunk(entry, { type: "text", text: "hi", id: "1" });
		store.finish(entry, { status: "ok", httpStatus: 200 });
		expect(readFileSync(filePath, "utf8").trim().split("\n")).toHaveLength(1);
		const reloaded = new LogStore({ filePath });
		expect(reloaded.list()).toHaveLength(1);
		expect(reloaded.get(entry.id)?.response.text).toBe("hi");
	});
});
