import { ProviderSettingsManager, isProviderSettingsUsable } from "@cline/core";
import { getModelsForProvider, getProviderIds } from "@cline/llms";

export interface ProxyModel {
	id: string;
	providerId: string;
	modelId: string;
	name: string;
	description?: string;
	contextWindow?: number;
}

export interface ModelCatalog {
	models: ProxyModel[];
	defaultModel?: string;
}

/** Split "providerId/model-slug" on the first slash. */
export function splitModelRef(ref: string): { providerId: string; modelId: string } {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) {
		throw new Error(`Model must look like "providerId/model-slug", got ${JSON.stringify(ref)}.`);
	}
	return { providerId: ref.slice(0, slash).trim(), modelId: ref.slice(slash + 1).trim() };
}

/**
 * Build the model catalog from the user's local Cline settings. Only
 * providers that are actually usable (credentials present or a keyless
 * endpoint) are listed. Model ids are "providerId/short-slug".
 */
export async function loadModelCatalog(manager: ProviderSettingsManager): Promise<ModelCatalog> {
	const state = manager.read();
	const lastUsed = state.lastUsedProvider;
	const defaultSettings = lastUsed
		? (manager.getLastUsedProviderSettings() as { model?: string } | undefined)
		: undefined;
	const storedDefault = defaultSettings?.model?.trim();
	const defaultModel =
		lastUsed && storedDefault
			? storedDefault.includes("/")
				? storedDefault
				: `${lastUsed}/${storedDefault}`
			: undefined;

	const out: ProxyModel[] = [];
	for (const id of getProviderIds()) {
		const settings = manager.getProviderSettings(id);
		if (!settings) {
			continue;
		}
		let usable = false;
		try {
			const config = manager.getProviderConfig(id, { includeKnownModels: false });
			usable = isProviderSettingsUsable(id, settings, config);
		} catch {
			usable = false;
		}
		if (!usable) {
			continue;
		}
		let models: Record<string, { name?: string; description?: string; contextWindow?: number }>;
		try {
			models = await getModelsForProvider(id, { filter: "chat" });
		} catch {
			continue;
		}
		for (const [shortId, info] of Object.entries(models)) {
			out.push({
				id: `${id}/${shortId}`,
				providerId: id,
				modelId: shortId,
				name: info.name ?? shortId,
				...(info.description ? { description: info.description } : {}),
				...(info.contextWindow !== undefined ? { contextWindow: info.contextWindow } : {}),
			});
		}
	}
	out.sort((a, b) => a.id.localeCompare(b.id));
	return { models: out, defaultModel };
}

/** Resolve an OpenAI `model` field to provider + model ids. */
export function resolveModelRef(
	model: string | undefined,
	catalog: ModelCatalog,
): { providerId: string; modelId: string } {
	const requested = model?.trim() || catalog.defaultModel;
	if (!requested) {
		throw new Error("No model specified and no default model configured in Cline settings.");
	}
	if (requested.includes("/")) {
		return splitModelRef(requested);
	}
	const match = catalog.models.find((entry) => entry.modelId === requested || entry.id === requested);
	if (match) {
		return { providerId: match.providerId, modelId: match.modelId };
	}
	throw new Error(
		`Unknown model ${JSON.stringify(requested)}. Use "providerId/model-slug" (see GET /v1/models).`,
	);
}
