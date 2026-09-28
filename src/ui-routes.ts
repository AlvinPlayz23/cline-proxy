import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogStore } from "./log-store.js";
import type { ModelCatalog } from "./models.js";
import { UI_HTML } from "./ui-html.js";

export interface UiContext {
	logs: LogStore;
	catalog: ModelCatalog;
	settingsPath: string;
	/** Address the server is bound to; loopback binds enforce a Host check. */
	host: string;
	/** Override for tests: returns SVG text, or undefined when no logo exists. */
	fetchLogo?: (providerId: string) => Promise<string | undefined>;
}

const LOGO_ALIASES: Record<string, string> = {
	"openai-native": "openai",
	"openai-codex": "openai",
	gemini: "google",
	vertex: "google-vertex",
	bedrock: "amazon-bedrock",
	"claude-code": "anthropic",
};
const LOGO_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_LOGO_BYTES = 200_000;
const logoCache = new Map<string, string | null>();

const UI_CSP =
	"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function json(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(text),
		"cache-control": "no-store",
	});
	res.end(text);
}

function isLoopback(host: string): boolean {
	return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
}

function requestHostname(header: string | undefined): string {
	if (!header) {
		return "";
	}
	if (header.startsWith("[")) {
		return header.slice(0, header.indexOf("]") + 1).toLowerCase();
	}
	return (header.split(":")[0] ?? "").toLowerCase();
}

async function fetchLogoFromModelsDev(providerId: string): Promise<string | undefined> {
	const slug = LOGO_ALIASES[providerId] ?? providerId;
	const response = await fetch(`https://models.dev/logos/${encodeURIComponent(slug)}.svg`, {
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) {
		if (response.status === 404) {
			return undefined;
		}
		throw new Error(`logo fetch failed: ${response.status}`);
	}
	const text = await response.text();
	return text.length <= MAX_LOGO_BYTES && text.trimStart().startsWith("<svg") ? text : undefined;
}

async function serveLogo(res: ServerResponse, providerId: string, ctx: UiContext): Promise<void> {
	if (!LOGO_ID.test(providerId)) {
		json(res, 404, { error: "not found" });
		return;
	}
	let svg = logoCache.get(providerId);
	if (svg === undefined) {
		try {
			svg = (await (ctx.fetchLogo ?? fetchLogoFromModelsDev)(providerId)) ?? null;
			logoCache.set(providerId, svg);
		} catch {
			res.writeHead(502, { "cache-control": "no-store" });
			res.end();
			return;
		}
	}
	if (svg === null) {
		res.writeHead(404, { "cache-control": "max-age=3600" });
		res.end();
		return;
	}
	res.writeHead(200, {
		"content-type": "image/svg+xml",
		"cache-control": "max-age=86400",
		"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
	});
	res.end(svg);
}

function serveEvents(req: IncomingMessage, res: ServerResponse, ctx: UiContext): void {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-store",
		connection: "keep-alive",
	});
	res.write(": connected\n\n");
	const unsubscribe = ctx.logs.subscribe((event) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	});
	const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
	req.on("close", () => {
		clearInterval(keepAlive);
		unsubscribe();
	});
}

function statePayload(ctx: UiContext): unknown {
	const counts = new Map<string, number>();
	for (const model of ctx.catalog.models) {
		counts.set(model.providerId, (counts.get(model.providerId) ?? 0) + 1);
	}
	return {
		settingsPath: ctx.settingsPath,
		defaultModel: ctx.catalog.defaultModel,
		providers: [...counts.entries()].map(([id, models]) => ({ id, models })),
		models: ctx.catalog.models.map((model) => ({
			id: model.id,
			providerId: model.providerId,
			name: model.name,
			contextWindow: model.contextWindow,
		})),
	};
}

/** Handle `/ui*` requests. Returns false when the path is not a UI route. */
export async function handleUiRequest(req: IncomingMessage, res: ServerResponse, url: URL, ctx: UiContext): Promise<boolean> {
	const path = url.pathname;
	if (path !== "/ui" && !path.startsWith("/ui/")) {
		return false;
	}
	if (isLoopback(ctx.host)) {
		const hostname = requestHostname(req.headers.host);
		if (!isLoopback(hostname)) {
			json(res, 403, { error: "Forbidden host." });
			return true;
		}
	}
	const method = req.method ?? "GET";

	if (method === "GET" && (path === "/ui" || path === "/ui/")) {
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": UI_CSP,
			"x-content-type-options": "nosniff",
		});
		res.end(UI_HTML);
		return true;
	}
	if (method === "GET" && path === "/ui/api/state") {
		json(res, 200, statePayload(ctx));
		return true;
	}
	if (method === "GET" && path === "/ui/api/logs") {
		json(res, 200, { logs: ctx.logs.list() });
		return true;
	}
	if (method === "DELETE" && path === "/ui/api/logs") {
		ctx.logs.clear();
		json(res, 200, { ok: true });
		return true;
	}
	if (method === "GET" && path.startsWith("/ui/api/logs/")) {
		const entry = ctx.logs.get(decodeURIComponent(path.slice("/ui/api/logs/".length)));
		if (entry) {
			json(res, 200, entry);
		} else {
			json(res, 404, { error: "Log entry not found." });
		}
		return true;
	}
	if (method === "GET" && path === "/ui/api/events") {
		serveEvents(req, res, ctx);
		return true;
	}
	if (method === "GET" && path.startsWith("/ui/logo/")) {
		await serveLogo(res, decodeURIComponent(path.slice("/ui/logo/".length)), ctx);
		return true;
	}
	json(res, 404, { error: `Not found: ${method} ${path}` });
	return true;
}
