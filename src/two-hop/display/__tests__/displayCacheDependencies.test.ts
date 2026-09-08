import { describe, expect, it } from "vitest";
import {
	createDisplayAssemblyCacheKey,
	createTagPreprocessCacheKey,
	selectDisplayAssemblySettings,
} from "../displayCacheDependencies";
import { DEFAULT_SETTINGS } from "settings/model";

describe("display cache keys", () => {
	it("selects the fixed assembly settings", () => {
		expect(selectDisplayAssemblySettings(DEFAULT_SETTINGS)).toEqual({
			useMergedLinksSection: false,
			showTagsSection: true,
		});
	});

	it("keys assembly settings and sort option within one sort context", () => {
		const first = createDisplayAssemblyCacheKey(DEFAULT_SETTINGS, "alphabetical");
		const changed = createDisplayAssemblyCacheKey(
			{ ...DEFAULT_SETTINGS, showTagsSection: false },
			"alphabetical",
		);
		expect(changed).not.toBe(first);
	});

	it("keys the tag feature setting", () => {
		const enabled = createTagPreprocessCacheKey({
			...DEFAULT_SETTINGS,
			enableTagFeatures: true,
		});
		const disabled = createTagPreprocessCacheKey({
			...DEFAULT_SETTINGS,
			enableTagFeatures: false,
		});
		expect(disabled).not.toBe(enabled);
	});
});
