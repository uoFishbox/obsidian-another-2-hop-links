import { describe, expect, it } from "vitest";
import {
	parsePluginSettings,
	PluginSettingsSchema,
} from "settings/model/settingsSchema";
import { DEFAULT_SETTINGS } from "settings/model/defaults";
import { SETTINGS_SCHEMA_VERSION, type PluginSettings } from "settings/model/settings";

describe("PluginSettingsSchema", () => {
	it("accepts a fully valid settings object unchanged", () => {
		const raw: PluginSettings = { ...DEFAULT_SETTINGS, language: "ja" };

		const result = PluginSettingsSchema.safeParse(raw);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(raw);
		}
	});

	it("falls back to defaults for invalid enum values", () => {
		const settings = parsePluginSettings({
			language: "fr",
			displayMode: "floating",
			lastUsedSortOption: "unknown-sort",
		});

		expect(settings.language).toBe("en");
		expect(settings.displayMode).toBe("editor-inline");
		expect(settings.lastUsedSortOption).toBe("alphabetical");
	});

	it("falls back to defaults for invalid boolean and string values", () => {
		const settings = parsePluginSettings({
			dedupeCards: "yes",
			frontmatterKeyCreatedDate: 123,
		});

		expect(settings.dedupeCards).toBe(DEFAULT_SETTINGS.dedupeCards);
		expect(settings.frontmatterKeyCreatedDate).toBe(
			DEFAULT_SETTINGS.frontmatterKeyCreatedDate,
		);
	});

	it("floors positive fractional user settings instead of discarding them", () => {
		const settings = parsePluginSettings({
			cardWidthPx: 140.9,
		});

		expect(settings.cardWidthPx).toBe(140);
	});

	it("falls back to defaults for out-of-range or non-numeric numbers", () => {
		const settings = parsePluginSettings({
			cardHeightRatio: 0,
			cardGapPx: Number.NaN,
			previewMaxChars: "500",
		});

		expect(settings.cardHeightRatio).toBe(DEFAULT_SETTINGS.cardHeightRatio);
		expect(settings.cardGapPx).toBe(DEFAULT_SETTINGS.cardGapPx);
		expect(settings.previewMaxChars).toBe(DEFAULT_SETTINGS.previewMaxChars);
	});

	it("strips unknown and obsolete keys", () => {
		const settings = parsePluginSettings({
			obsoleteSetting: { retained: false },
			twoHopListMode: "precise-virtual",
			enableTwoRowMountedOverscan: true,
			renderCodeBlockTypes: ["mermaid"],
			previewActivationAheadRows: 2,
			previewDomCommitsPerSecond: 40,
			searchPreviewSeekThresholdChars: 20,
			searchPreviewSeekBufferChars: 8,
			enableProgressiveTwoHopBuild: false,
			maxOutgoingToProcess: 10,
		});

		expect(settings).not.toHaveProperty("obsoleteSetting");
		expect(settings).not.toHaveProperty("twoHopListMode");
		expect(settings).not.toHaveProperty("enableTwoRowMountedOverscan");
		expect(settings).not.toHaveProperty("renderCodeBlockTypes");
		expect(settings).not.toHaveProperty("previewActivationAheadRows");
		expect(settings).not.toHaveProperty("previewDomCommitsPerSecond");
		expect(settings).not.toHaveProperty("searchPreviewSeekThresholdChars");
		expect(settings).not.toHaveProperty("searchPreviewSeekBufferChars");
		expect(settings).not.toHaveProperty("enableProgressiveTwoHopBuild");
		expect(settings).not.toHaveProperty("maxOutgoingToProcess");
	});

	it("always reports the current schema version", () => {
		const fromMissing = parsePluginSettings({});
		const fromStale = parsePluginSettings({ settingsSchemaVersion: 999 });

		expect(fromMissing.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
		expect(fromStale.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
	});

	it("returns full defaults for non-object input", () => {
		expect(parsePluginSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(parsePluginSettings("corrupted")).toEqual(DEFAULT_SETTINGS);
		expect(parsePluginSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
	});
});
