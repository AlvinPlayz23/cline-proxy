#!/usr/bin/env node
import { detectClineInstall } from "./cline-detection.js";
import { startProxyServer } from "./server.js";

function argValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	const found = process.argv.find((arg) => arg.startsWith(prefix));
	if (found) {
		return found.slice(prefix.length);
	}
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0 && index + 1 < process.argv.length) {
		return process.argv[index + 1];
	}
	return undefined;
}

function hasFlag(...names: string[]): boolean {
	return names.some((name) => process.argv.includes(name));
}

function printHelp(): void {
	console.log(`cline-proxy — OpenAI-compatible server over your Cline providers

Usage:
  cline-proxy serve [--port 18789] [--host 127.0.0.1] [--cline-dir PATH]
                    [--data-dir PATH] [--providers-path PATH]

Detects your Cline installation (~/.cline by default; CLINE_DIR,
CLINE_DATA_DIR, CLINE_PROVIDER_SETTINGS_PATH env vars honored), then serves:
  GET  /v1/models
  POST /v1/chat/completions   (OpenAI-compatible, stream + non-stream)

Use models as "providerId/model-slug", e.g. "anthropic/claude-sonnet-5".
Tools are passed through to the provider (OpenAI-compatible tool_calls);
the client owns the tool loop — the proxy never executes tools.`);
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const [command] = args.filter((arg) => !arg.startsWith("-"));
	if (hasFlag("--help", "-h") || command === "help" || args.length === 0) {
		printHelp();
		return 0;
	}
	if (command !== undefined && command !== "serve") {
		console.error(`Unknown command ${JSON.stringify(command)}. Try: cline-proxy serve --help`);
		return 1;
	}
	const portRaw = argValue("port") ?? process.env.CLINE_PROXY_PORT;
	const port = portRaw ? Number.parseInt(portRaw, 10) : 18789;
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		console.error(`Invalid --port: ${JSON.stringify(portRaw)}.`);
		return 1;
	}
	const install = detectClineInstall({
		clineDir: argValue("cline-dir"),
		dataDir: argValue("data-dir"),
		providersPath: argValue("providers-path"),
	});
	if (!install.providersFileExists) {
		console.error(
			`No Cline provider settings found at ${install.providersPath}.\nRun \`cline auth\` first, or set CLINE_PROVIDER_SETTINGS_PATH.`,
		);
		return 1;
	}
	try {
		const proxy = await startProxyServer({
			host: argValue("host") ?? process.env.CLINE_PROXY_HOST ?? "127.0.0.1",
			port,
			clineDir: argValue("cline-dir"),
			dataDir: argValue("data-dir"),
			providersPath: argValue("providers-path"),
		});
		console.log(`cline-proxy listening on ${proxy.url}`);
		console.log(`Cline settings: ${proxy.settingsPath}`);
		console.log(`Models: ${proxy.catalog.models.length} across configured providers`);
		if (proxy.catalog.defaultModel) {
			console.log(`Default model: ${proxy.catalog.defaultModel}`);
		}
		console.log(`Point any OpenAI-compatible client at ${proxy.url}/v1`);
		const shutdown = async (): Promise<void> => {
			await proxy.close();
			process.exit(0);
		};
		process.on("SIGINT", () => void shutdown());
		process.on("SIGTERM", () => void shutdown());
		await new Promise(() => {});
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

const code = await main();
process.exit(code);
