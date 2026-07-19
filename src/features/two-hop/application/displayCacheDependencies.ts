import type { PluginSettings } from "features/settings/model";
import { areTagFeaturesEnabled } from "features/settings/model";

export interface SettingsCacheDependency<Key extends string = string, Value = unknown> {
	key: Key;
	select: (settings: PluginSettings) => Value;
}

export type SelectedSettingsDependencies<
	Dependencies extends readonly SettingsCacheDependency[],
> = {
	[Dependency in Dependencies[number] as Dependency["key"]]: ReturnType<
		Dependency["select"]
	>;
};

function createSettingDependency<Key extends keyof PluginSettings>(
	key: Key,
): SettingsCacheDependency<Key, PluginSettings[Key]> {
	return {
		key,
		select: (settings) => settings[key],
	};
}

function createDerivedSettingDependency<Key extends string, Value>(
	key: Key,
	select: (settings: PluginSettings) => Value,
): SettingsCacheDependency<Key, Value> {
	return { key, select };
}

function mergeSettingsCacheDependencies<
	const Groups extends readonly (readonly SettingsCacheDependency[])[],
>(...groups: Groups): readonly Groups[number][number][] {
	const dependenciesByKey = new Map<string, Groups[number][number]>();

	for (const group of groups) {
		for (const dependency of group) {
			dependenciesByKey.set(dependency.key, dependency);
		}
	}

	return [...dependenciesByKey.values()];
}

const EXCLUDE_ATTACHMENTS_DEPENDENCY = createSettingDependency("excludeAttachments");
const TWO_HOP_HEADER_SORT_ORDER_DEPENDENCY = createSettingDependency(
	"twoHopHeaderSortOrder",
);
const DEDUPE_CARDS_DEPENDENCY = createSettingDependency("dedupeCards");
const TAG_FEATURES_ENABLED_DEPENDENCY = createDerivedSettingDependency(
	"tagFeaturesEnabled",
	areTagFeaturesEnabled,
);
const SHOW_TAGS_SECTION_DEPENDENCY = createSettingDependency("showTagsSection");
const USE_MERGED_LINKS_SECTION_DEPENDENCY = createSettingDependency(
	"useMergedLinksSection",
);

/**
 * Settings read while preprocessing links.
 */
export const LINK_DISPLAY_PREPROCESS_SETTING_DEPENDENCIES = [
	EXCLUDE_ATTACHMENTS_DEPENDENCY,
	TWO_HOP_HEADER_SORT_ORDER_DEPENDENCY,
] as const;

/**
 * Settings read while preprocessing tagged notes.
 */
export const TAG_DISPLAY_PREPROCESS_SETTING_DEPENDENCIES = [
	EXCLUDE_ATTACHMENTS_DEPENDENCY,
	TAG_FEATURES_ENABLED_DEPENDENCY,
	SHOW_TAGS_SECTION_DEPENDENCY,
] as const;

/**
 * Settings read while assembling already-preprocessed display data.
 */
export const DISPLAY_ASSEMBLY_SETTING_DEPENDENCIES = [
	USE_MERGED_LINKS_SECTION_DEPENDENCY,
	SHOW_TAGS_SECTION_DEPENDENCY,
] as const;

/**
 * Link preprocessing cache dependencies, including orchestration settings.
 */
export const LINK_PREPROCESS_CACHE_SETTING_DEPENDENCIES =
	mergeSettingsCacheDependencies(LINK_DISPLAY_PREPROCESS_SETTING_DEPENDENCIES, [
		DEDUPE_CARDS_DEPENDENCY,
	]);

/**
 * Tag preprocessing cache dependencies, including orchestration settings.
 */
export const TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES = mergeSettingsCacheDependencies(
	TAG_DISPLAY_PREPROCESS_SETTING_DEPENDENCIES,
	[DEDUPE_CARDS_DEPENDENCY],
);

/**
 * Combined preprocessing cache dependencies.
 */
export const PREPROCESS_CACHE_SETTING_DEPENDENCIES = mergeSettingsCacheDependencies(
	LINK_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
	TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
);

/**
 * Selects the declared settings into a stable structured object.
 */
export function selectSettingsDependencies<
	const Dependencies extends readonly SettingsCacheDependency[],
>(
	settings: PluginSettings,
	dependencies: Dependencies,
): SelectedSettingsDependencies<Dependencies> {
	const selectedSettings: Record<string, unknown> = {};

	for (const dependency of dependencies) {
		selectedSettings[dependency.key] = dependency.select(settings);
	}

	return selectedSettings as SelectedSettingsDependencies<Dependencies>;
}

/**
 * Serializes a structured cache key without fixed-width packing.
 */
export function createStructuredCacheKey(key: unknown): string {
	return JSON.stringify(key);
}

/**
 * Creates a cache key from an explicit settings dependency declaration.
 */
export function createSettingsCacheKey(
	settings: PluginSettings,
	dependencies: readonly SettingsCacheDependency[],
): string {
	return createStructuredCacheKey(selectSettingsDependencies(settings, dependencies));
}
