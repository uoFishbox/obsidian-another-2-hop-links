import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { createCardPreviewRenderRequestResolver } from "../cardPreviewRenderRequest";

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
	return {
		...DEFAULT_SETTINGS,
		renderCodeBlockTypes: [...DEFAULT_SETTINGS.renderCodeBlockTypes],
		...overrides,
	};
}

describe("createCardPreviewRenderRequestResolver", () => {
	it("reuses projected preview settings for the same settings object", () => {
		const resolve = createCardPreviewRenderRequestResolver();
		const file = createMockTFile("notes/cached-preview-settings.md");
		const settings = createSettings();

		const first = resolve(file, 0, null, "0", "first", settings);
		const second = resolve(file, 0, null, "0", "second", settings);

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(second?.settings).toBe(first?.settings);
	});

	it("invalidates the projection after an in-place relevant setting update", () => {
		const resolve = createCardPreviewRenderRequestResolver();
		const file = createMockTFile("notes/updated-preview-settings.md");
		const settings = createSettings({ renderCodeBlockTypes: ["dataview"] });

		const first = resolve(file, 0, null, "0", "first", settings);
		settings.previewMaxChars += 1;
		settings.renderCodeBlockTypes.push("query");
		const second = resolve(file, 0, null, "0", "second", settings);

		expect(second?.settings).not.toBe(first?.settings);
		expect(second?.settings.previewMaxChars).toBe(settings.previewMaxChars);
		expect(second?.settings.renderCodeBlockTypes).toEqual(["dataview", "query"]);
		expect(first?.settings.renderCodeBlockTypes).toEqual(["dataview"]);
	});

	it("keeps the projection after an unrelated in-place setting update", () => {
		const resolve = createCardPreviewRenderRequestResolver();
		const file = createMockTFile("notes/unrelated-preview-settings.md");
		const settings = createSettings();

		const first = resolve(file, 0, null, "0", "first", settings);
		settings.language = settings.language === "en" ? "ja" : "en";
		const second = resolve(file, 0, null, "0", "second", settings);

		expect(second?.settings).toBe(first?.settings);
	});
});
