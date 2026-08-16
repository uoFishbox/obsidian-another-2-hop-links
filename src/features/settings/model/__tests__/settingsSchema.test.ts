import { describe, expect, it } from "vitest";
import {
	parsePluginSettings,
	PluginSettingsSchema,
} from "features/settings/model/settingsSchema";
import { DEFAULT_SETTINGS } from "features/settings/model/defaults";
import {
	SETTINGS_SCHEMA_VERSION,
	type PluginSettings,
} from "features/settings/model/settings";

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
			enableLogging: 1,
			frontmatterKeyCreatedDate: 123,
			ripgrepExecutablePath: null,
		});

		expect(settings.dedupeCards).toBe(DEFAULT_SETTINGS.dedupeCards);
		expect(settings.enableLogging).toBe(DEFAULT_SETTINGS.enableLogging);
		expect(settings.frontmatterKeyCreatedDate).toBe(
			DEFAULT_SETTINGS.frontmatterKeyCreatedDate,
		);
		expect(settings.ripgrepExecutablePath).toBe(
			DEFAULT_SETTINGS.ripgrepExecutablePath,
		);
	});

	it("falls back to an empty array when renderCodeBlockTypes is not an array", () => {
		const settings = parsePluginSettings({
			renderCodeBlockTypes: 123,
		});

		expect(settings.renderCodeBlockTypes).toEqual([]);
	});

	it("floors positive fractional numbers instead of discarding them", () => {
		const settings = parsePluginSettings({
			previewActivationAheadRows: 2.8,
			previewDomCommitsPerSecond: 40.8,
			cardWidthPx: 140.9,
		});

		expect(settings.previewActivationAheadRows).toBe(2);
		expect(settings.previewDomCommitsPerSecond).toBe(40);
		expect(settings.cardWidthPx).toBe(140);
	});

	it("falls back to defaults for out-of-range or non-numeric numbers", () => {
		const settings = parsePluginSettings({
			previewActivationAheadRows: -1,
			cardHeightRatio: 0,
			cardGapPx: Number.NaN,
			previewMaxChars: "500",
			maxOutgoingToProcess: -3,
		});

		expect(settings.previewActivationAheadRows).toBe(1);
		expect(settings.cardHeightRatio).toBe(DEFAULT_SETTINGS.cardHeightRatio);
		expect(settings.cardGapPx).toBe(DEFAULT_SETTINGS.cardGapPx);
		expect(settings.previewMaxChars).toBe(DEFAULT_SETTINGS.previewMaxChars);
		expect(settings.maxOutgoingToProcess).toBe(
			DEFAULT_SETTINGS.maxOutgoingToProcess,
		);
	});

	it("strips unknown and obsolete keys", () => {
		const settings = parsePluginSettings({
			obsoleteSetting: { retained: false },
			twoHopListMode: "precise-virtual",
			enableTwoRowMountedOverscan: true,
		});

		expect(settings).not.toHaveProperty("obsoleteSetting");
		expect(settings).not.toHaveProperty("twoHopListMode");
		expect(settings).not.toHaveProperty("enableTwoRowMountedOverscan");
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

	it("does not share nested arrays between parsed results and defaults", () => {
		const first = parsePluginSettings({ renderCodeBlockTypes: ["mermaid"] });
		const second = parsePluginSettings({});

		first.renderCodeBlockTypes.push("obsidian");

		expect(second.renderCodeBlockTypes).toEqual([]);
		expect(DEFAULT_SETTINGS.renderCodeBlockTypes).toEqual([]);
	});
});
