import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type PluginSettings } from "settings/model";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { compileCardPreviewRequest } from "preview/pipeline/cardPreviewRequest";

function compile(
	file: ReturnType<typeof createMockTFile>,
	settings: PluginSettings,
	searchQuery: string,
) {
	return compileCardPreviewRequest({
		file,
		settings,
		searchQuery,
		previewOverride: null,
		previewRenderVersion: "0",
	});
}

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
	return {
		...DEFAULT_SETTINGS,
		...overrides,
	};
}

describe("compileCardPreviewRequest", () => {
	it("reuses projected preview settings for the same settings object", () => {
		const file = createMockTFile("notes/cached-preview-settings.md");
		const settings = createSettings();

		const first = compile(file, settings, "first");
		const second = compile(file, settings, "second");

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(second?.settings).toBe(first?.settings);
	});

	it("invalidates the projection after an in-place relevant setting update", () => {
		const file = createMockTFile("notes/updated-preview-settings.md");
		const settings = createSettings();

		const first = compile(file, settings, "first");
		settings.previewMaxChars += 1;
		const second = compile(file, settings, "second");

		expect(second?.settings).not.toBe(first?.settings);
		expect(second?.settings.previewMaxChars).toBe(settings.previewMaxChars);
	});

	it("keeps the projection after an unrelated in-place setting update", () => {
		const file = createMockTFile("notes/unrelated-preview-settings.md");
		const settings = createSettings();

		const first = compile(file, settings, "first");
		settings.language = settings.language === "en" ? "ja" : "en";
		const second = compile(file, settings, "second");

		expect(second?.settings).toBe(first?.settings);
	});
});
