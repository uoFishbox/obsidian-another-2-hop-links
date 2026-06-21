import { describe, expect, it } from "vitest";
import {
	createSettingsCacheKey,
	DISPLAY_ASSEMBLY_SETTING_DEPENDENCIES,
	selectSettingsDependencies,
	TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
} from "../displayCacheDependencies";
import { DEFAULT_SETTINGS } from "types/settings";

describe("displayCacheDependencies", () => {
	it("selects only the declared assembly settings", () => {
		expect(
			selectSettingsDependencies(
				DEFAULT_SETTINGS,
				DISPLAY_ASSEMBLY_SETTING_DEPENDENCIES,
			),
		).toEqual({
			useMergedLinksSection: false,
			showTagsSection: true,
		});
	});

	it("normalizes the optional tag feature setting before keying", () => {
		const enabledKey = createSettingsCacheKey(
			{ ...DEFAULT_SETTINGS, enableTagFeatures: true },
			TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
		);
		const defaultEnabledKey = createSettingsCacheKey(
			{ ...DEFAULT_SETTINGS, enableTagFeatures: undefined },
			TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
		);
		const disabledKey = createSettingsCacheKey(
			{ ...DEFAULT_SETTINGS, enableTagFeatures: false },
			TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
		);

		expect(defaultEnabledKey).toBe(enabledKey);
		expect(disabledKey).not.toBe(enabledKey);
	});
});
