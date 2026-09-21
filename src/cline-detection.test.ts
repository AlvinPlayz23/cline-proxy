import { describe, expect, test } from "bun:test";
import { detectClineInstall } from "./cline-detection.js";

describe("detectClineInstall", () => {
	test("honors explicit overrides", () => {
		const found = detectClineInstall({ providersPath: "/tmp/nowhere-providers.json" });
		expect(found.providersPath).toBe("/tmp/nowhere-providers.json");
		expect(found.providersFileExists).toBe(false);
	});

	test("defaults under the home directory", () => {
		const found = detectClineInstall({ clineDir: "/tmp/fake-home/.cline" });
		expect(found.providersPath).toBe("/tmp/fake-home/.cline/data/settings/providers.json");
	});
});
