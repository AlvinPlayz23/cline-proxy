import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClineInstall {
	/** ~/.cline (or CLINE_DIR). */
	clineDir: string;
	/** <clineDir>/data (or CLINE_DATA_DIR). */
	dataDir: string;
	/** <dataDir>/settings/providers.json (or CLINE_PROVIDER_SETTINGS_PATH). */
	providersPath: string;
	providersFileExists: boolean;
}

export interface ClinePathOverrides {
	clineDir?: string;
	dataDir?: string;
	providersPath?: string;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Locate the current user's Cline installation. Mirrors the resolution in
 * @cline/shared storage paths: explicit override > env var > OS default.
 */
export function detectClineInstall(overrides: ClinePathOverrides = {}): ClineInstall {
	const clineDir =
		nonEmpty(overrides.clineDir) ?? nonEmpty(process.env.CLINE_DIR) ?? join(homedir(), ".cline");
	const dataDir =
		nonEmpty(overrides.dataDir) ?? nonEmpty(process.env.CLINE_DATA_DIR) ?? join(clineDir, "data");
	const providersPath =
		nonEmpty(overrides.providersPath) ??
		nonEmpty(process.env.CLINE_PROVIDER_SETTINGS_PATH) ??
		join(dataDir, "settings", "providers.json");
	return { clineDir, dataDir, providersPath, providersFileExists: existsSync(providersPath) };
}
