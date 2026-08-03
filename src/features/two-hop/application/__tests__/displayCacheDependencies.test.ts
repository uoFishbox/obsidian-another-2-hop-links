import { describe, expect, it } from "vitest";
import {
	createDisplayAssemblyCacheKey,
	createTagPreprocessCacheKey,
	selectDisplayAssemblySettings,
} from "../displayCacheDependencies";
import { DEFAULT_SETTINGS } from "features/settings/model";

describe("display cache keys", () => {
	it("selects the fixed assembly settings", () => {
		expect(selectDisplayAssemblySettings(DEFAULT_SETTINGS)).toEqual({
			useMergedLinksSection: false,
			showTagsSection: true,
		});
	});

	it("keys assembly settings, sort option, and sort context", () => {
		const first = createDisplayAssemblyCacheKey(
			DEFAULT_SETTINGS,
			"alphabetical",
			1,
		);
		const changed = createDisplayAssemblyCacheKey(
			{ ...DEFAULT_SETTINGS, showTagsSection: false },
			"alphabetical",
			1,
		);
		expect(changed).not.toBe(first);
	});

	it("normalizes the optional tag feature setting", () => {
		const enabled = createTagPreprocessCacheKey({
			...DEFAULT_SETTINGS,
			enableTagFeatures: true,
		});
		const defaultEnabled = createTagPreprocessCacheKey({
			...DEFAULT_SETTINGS,
			enableTagFeatures: undefined,
		});
		const disabled = createTagPreprocessCacheKey({
			...DEFAULT_SETTINGS,
			enableTagFeatures: false,
		});
		expect(defaultEnabled).toBe(enabled);
		expect(disabled).not.toBe(enabled);
	});
});
