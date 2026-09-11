import { describe, expect, it } from "vitest";
import { parsePluginSettings } from "settings/model/settingsSchema";
import { DEFAULT_SETTINGS } from "settings/model/defaults";
import { SETTINGS_SCHEMA_VERSION, type PluginSettings } from "settings/model/settings";

describe("parsePluginSettings", () => {
	it.each(["relevance", "relevance-reverse"] as const)(
		"restores the %s sort selection",
		(sortOption) => {
			expect(
				parsePluginSettings({ lastUsedSortOption: sortOption })
					.lastUsedSortOption,
			).toBe(sortOption);
		},
	);
	it.each([undefined, null, "true", 1, false])(
		"keeps experimental title editing disabled for %s",
		(value) => {
			expect(
				parsePluginSettings({ experimentalCosenseTitleEditing: value })
					.experimentalCosenseTitleEditing,
			).toBe(false);
		},
	);

	it("preserves an explicit opt-in to experimental title editing", () => {
		expect(
			parsePluginSettings({ experimentalCosenseTitleEditing: true })
				.experimentalCosenseTitleEditing,
		).toBe(true);
	});

	it("preserves experimental Shadow DOM CSS only when it is a string", () => {
		const css = ".card { color: rebeccapurple; }";
		expect(parsePluginSettings({ experimentalShadowDomCss: css })).toMatchObject({
			experimentalShadowDomCss: css,
		});
		expect(
			parsePluginSettings({ experimentalShadowDomCss: 123 })
				.experimentalShadowDomCss,
		).toBe("");
	});

	it("accepts a fully valid settings object unchanged", () => {
		const raw: PluginSettings = { ...DEFAULT_SETTINGS, language: "ja" };

		expect(parsePluginSettings(raw)).toEqual(raw);
	});

	it("parses highlight on open as a boolean", () => {
		expect(parsePluginSettings({ highlightOnOpen: false }).highlightOnOpen).toBe(
			false,
		);
		expect(parsePluginSettings({ highlightOnOpen: "always" }).highlightOnOpen).toBe(
			DEFAULT_SETTINGS.highlightOnOpen,
		);
	});

	it("falls back to defaults for invalid enum values", () => {
		const settings = parsePluginSettings({
			language: "fr",
			displayMode: "floating",
			lastUsedSortOption: "unknown-sort",
			quickSortField1: "unknown-field",
			quickSortField2: 2,
		});

		expect(settings.language).toBe("en");
		expect(settings.displayMode).toBe("editor-inline");
		expect(settings.lastUsedSortOption).toBe("alphabetical");
		expect(settings.quickSortField1).toBe(DEFAULT_SETTINGS.quickSortField1);
		expect(settings.quickSortField2).toBe(DEFAULT_SETTINGS.quickSortField2);
	});

	it("restores configured pinned sort fields", () => {
		const settings = parsePluginSettings({
			quickSortField1: "relevance",
			quickSortField2: "file-size",
		});

		expect(settings.quickSortField1).toBe("relevance");
		expect(settings.quickSortField2).toBe("file-size");
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

	it("accepts zero card gap", () => {
		const settings = parsePluginSettings({
			cardGapPx: 0,
		});

		expect(settings.cardGapPx).toBe(0);
	});

	it("falls back to defaults for out-of-range or non-numeric numbers", () => {
		const settings = parsePluginSettings({
			cardHeightRatio: 0,
			cardGapPx: Number.NaN,
			cardMaxColumns: Number.POSITIVE_INFINITY,
			previewMaxChars: "500",
		});

		expect(settings.cardHeightRatio).toBe(DEFAULT_SETTINGS.cardHeightRatio);
		expect(settings.cardGapPx).toBe(DEFAULT_SETTINGS.cardGapPx);
		expect(settings.cardMaxColumns).toBe(DEFAULT_SETTINGS.cardMaxColumns);
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
