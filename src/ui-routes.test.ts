import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LogStore } from "./log-store.js";
import { handleUiRequest } from "./ui-routes.js";

let server: Server;
let base: string;
const logs = new LogStore();
const fetched: string[] = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		void handleUiRequest(req, res, url, {
			logs,
			catalog: {
				defaultModel: "deepseek/deepseek-v4-flash",
				models: [{ id: "deepseek/deepseek-v4-flash", providerId: "deepseek", modelId: "deepseek-v4-flash", name: "V4 Flash", contextWindow: 1000 }],
			},
			settingsPath: "/tmp/providers.json",
			host: "127.0.0.1",
			fetchLogo: async (id) => {
				fetched.push(id);
				return id === "deepseek" ? "<svg xmlns='http://www.w3.org/2000/svg'/>" : undefined;
			},
		}).then((handled) => {
			if (!handled) {
				res.writeHead(404).end();
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
	server.close();
});

describe("ui routes", () => {
	test("serves the dashboard with a restrictive CSP", async () => {
		const res = await fetch(`${base}/ui`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(await res.text()).toContain("</html>");
	});

	test("lists logs, returns a full entry, and clears", async () => {
		const entry = logs.begin({
			req: { headers: {}, socket: {} } as never,
			endpoint: "/v1/chat/completions",
			request: { messages: [{ role: "user", content: "ping" }] },
			stream: false,
		});
		logs.finish(entry, { status: "ok", httpStatus: 200 });
		const list = (await (await fetch(`${base}/ui/api/logs`)).json()) as { logs: Array<{ id: string; preview: string }> };
		expect(list.logs[0]?.preview).toBe("ping");
		const full = (await (await fetch(`${base}/ui/api/logs/${entry.id}`)).json()) as { id: string; request: unknown };
		expect(full.id).toBe(entry.id);
		expect((await fetch(`${base}/ui/api/logs/nope`)).status).toBe(404);
		expect((await fetch(`${base}/ui/api/logs`, { method: "DELETE" })).status).toBe(200);
		const after = (await (await fetch(`${base}/ui/api/logs`)).json()) as { logs: unknown[] };
		expect(after.logs).toHaveLength(0);
	});

	test("exposes providers and models", async () => {
		const state = (await (await fetch(`${base}/ui/api/state`)).json()) as { providers: Array<{ id: string; models: number }>; defaultModel: string };
		expect(state.providers).toEqual([{ id: "deepseek", models: 1 }]);
		expect(state.defaultModel).toBe("deepseek/deepseek-v4-flash");
	});

	test("serves and caches logos; unknown providers 404; bad ids rejected", async () => {
		const ok = await fetch(`${base}/ui/logo/deepseek`);
		expect(ok.headers.get("content-type")).toBe("image/svg+xml");
		await fetch(`${base}/ui/logo/deepseek`);
		expect(fetched.filter((id) => id === "deepseek")).toHaveLength(1);
		expect((await fetch(`${base}/ui/logo/nothing-here`)).status).toBe(404);
		expect((await fetch(`${base}/ui/logo/..%2Fetc`)).status).toBe(404);
	});

	test("rejects foreign Host headers on loopback binds (DNS rebinding)", async () => {
		const { request } = await import("node:http");
		const status = await new Promise<number>((resolve, reject) => {
			const req = request({ host: "127.0.0.1", port: new URL(base).port, path: "/ui/api/logs", headers: { host: "evil.example" } }, (res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			});
			req.on("error", reject);
			req.end();
		});
		expect(status).toBe(403);
	});

	test("ignores non-UI paths", async () => {
		expect((await fetch(`${base}/v1/models`)).status).toBe(404);
	});
});
