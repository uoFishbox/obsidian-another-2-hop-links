import {
	areTagFeaturesEnabled,
	type PluginSettings,
	type SortOption,
} from "features/settings/model";

export interface LinkDisplayPreprocessSettings {
	readonly excludeAttachments: boolean;
	readonly twoHopHeaderSortOrder: PluginSettings["twoHopHeaderSortOrder"];
}

export interface TagDisplayPreprocessSettings {
	readonly excludeAttachments: boolean;
	readonly tagFeaturesEnabled: boolean;
	readonly showTagsSection: boolean;
}

export interface DisplayAssemblySettings {
	readonly useMergedLinksSection: boolean;
	readonly showTagsSection: boolean;
}

/** Selects the fixed settings read by link preprocessing. */
export function selectLinkDisplayPreprocessSettings(
	settings: PluginSettings,
): LinkDisplayPreprocessSettings {
	return {
		excludeAttachments: settings.excludeAttachments,
		twoHopHeaderSortOrder: settings.twoHopHeaderSortOrder,
	};
}

/** Selects the fixed settings read by tag preprocessing. */
export function selectTagDisplayPreprocessSettings(
	settings: PluginSettings,
): TagDisplayPreprocessSettings {
	return {
		excludeAttachments: settings.excludeAttachments,
		tagFeaturesEnabled: areTagFeaturesEnabled(settings),
		showTagsSection: settings.showTagsSection,
	};
}

/** Selects the fixed settings read while assembling display data. */
export function selectDisplayAssemblySettings(
	settings: PluginSettings,
): DisplayAssemblySettings {
	return {
		useMergedLinksSection: settings.useMergedLinksSection,
		showTagsSection: settings.showTagsSection,
	};
}

export function createLinkPreprocessCacheKey(settings: PluginSettings): string {
	return JSON.stringify([
		settings.excludeAttachments,
		settings.twoHopHeaderSortOrder,
		settings.dedupeCards,
	]);
}

export function createTagPreprocessCacheKey(settings: PluginSettings): string {
	return JSON.stringify([
		settings.excludeAttachments,
		areTagFeaturesEnabled(settings),
		settings.showTagsSection,
		settings.dedupeCards,
	]);
}

export function createPreprocessCacheKey(settings: PluginSettings): string {
	return JSON.stringify([
		settings.excludeAttachments,
		settings.twoHopHeaderSortOrder,
		settings.dedupeCards,
		areTagFeaturesEnabled(settings),
		settings.showTagsSection,
	]);
}

export function createDisplayAssemblyCacheKey(
	settings: PluginSettings,
	sortOption: SortOption,
	sortContextVersion: number,
): string {
	return JSON.stringify([
		settings.useMergedLinksSection,
		settings.showTagsSection,
		sortOption,
		sortContextVersion,
	]);
}
