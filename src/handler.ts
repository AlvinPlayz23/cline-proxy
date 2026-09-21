import { ProviderSettingsManager, toProviderConfig } from "@cline/core";
import { createHandlerAsync, normalizeProviderId, resolveProviderRequestHeaders } from "@cline/llms";
import type { ApiHandler, ProviderConfig } from "@cline/llms";
import type { ProviderSettings } from "@cline/core";

export interface ResolvedHandler {
	handler: ApiHandler;
	providerId: string;
	modelId: string;
}

function randomId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build an ApiHandler for provider/model, layering per-request overrides onto
 * the user's stored Cline provider settings. Mirrors the header assembly in
 * local-runtime-bootstrap: stored headers plus the Cline billing headers
 * (User-Agent, X-CLIENT-*, X-CORE-VERSION, X-Task-ID).
 */
export async function createHandlerForModel(
	manager: ProviderSettingsManager,
	providerId: string,
	modelId: string,
	overrides: { maxOutputTokens?: number; temperature?: number },
	meta: { coreVersion: string; sessionId?: string; signal?: AbortSignal },
): Promise<ResolvedHandler> {
	const normalized = normalizeProviderId(providerId);
	const settings = manager.getProviderSettings(normalized) as
		| (ProviderSettings & { headers?: Record<string, string> })
		| undefined;
	if (!settings) {
		throw new Error(
			`Provider ${JSON.stringify(normalized)} is not configured in your Cline settings.`,
		);
	}
	const withModel: ProviderSettings = { ...settings, provider: settings.provider, model: modelId };
	const base = toProviderConfig(withModel);
	const sessionId = meta.sessionId ?? randomId();
	const headers = resolveProviderRequestHeaders({
		providerId: normalized,
		sessionId,
		source: "proxy",
		defaultSource: "proxy",
		client: { name: "cline-proxy", version: meta.coreVersion, platform: "proxy" },
		coreVersion: meta.coreVersion,
		headers: { stored: settings.headers },
	});
	const config: ProviderConfig = {
		...base,
		providerId: normalized,
		modelId,
		...(overrides.maxOutputTokens !== undefined
			? { maxOutputTokens: overrides.maxOutputTokens }
			: {}),
		...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
		...(headers ? { headers } : {}),
		...(meta.signal ? { abortSignal: meta.signal } : {}),
	};
	return { handler: await createHandlerAsync(config), providerId: normalized, modelId };
}
