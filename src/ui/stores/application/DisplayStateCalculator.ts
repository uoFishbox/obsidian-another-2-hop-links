import type {
	DisplayDataBuilder,
	DisplayData,
	LinkPreprocessedDisplayData,
	PreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "features/two-hop/application/displayDataBuilder";
import type { TwoHopLinkResult } from "types";
import type { PluginSettings, SortOption } from "types/settings";
import {
	createSettingsCacheKey,
	LINK_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
	PREPROCESS_CACHE_SETTING_DEPENDENCIES,
	TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES,
} from "features/two-hop/application/displayCacheDependencies";

export interface ComputedDisplayData {
	displayData: DisplayData;
	hasDisplayableItems: boolean;
}

export interface ComputedPreprocessedDisplayData {
	preprocessed: PreprocessedDisplayData;
}

export interface PreprocessedDisplayDataCache {
	linkEntry: LinkPreprocessedDisplayDataCacheEntry | undefined;
	tagEntry: TagPreprocessedDisplayDataCacheEntry | undefined;
	combinedEntry: CombinedPreprocessedDisplayDataCacheEntry | undefined;
}

interface LinkPreprocessedDisplayDataCacheEntry {
	branchesRef: TwoHopLinkResult["branches"] | undefined;
	backlinksRef: TwoHopLinkResult["backlinks"] | undefined;
	preprocessSettingsKey: string;
	preprocessed: LinkPreprocessedDisplayData;
}

interface TagPreprocessedDisplayDataCacheEntry {
	taggedNotesRef: TwoHopLinkResult["taggedNotes"] | undefined;
	preprocessSettingsKey: string;
	preprocessed: TagPreprocessedDisplayData;
}

interface CombinedPreprocessedDisplayDataCacheEntry {
	branchesRef: TwoHopLinkResult["branches"] | undefined;
	backlinksRef: TwoHopLinkResult["backlinks"] | undefined;
	taggedNotesRef: TwoHopLinkResult["taggedNotes"] | undefined;
	linkPreprocessed: LinkPreprocessedDisplayData;
	tagPreprocessed: TagPreprocessedDisplayData;
	preprocessSettingsKey: string;
	preprocessed: PreprocessedDisplayData;
}

export function createPreprocessedDisplayDataCache(): PreprocessedDisplayDataCache {
	return {
		linkEntry: undefined,
		tagEntry: undefined,
		combinedEntry: undefined,
	};
}

function createPreprocessSettingsKey(settings: PluginSettings): string {
	return createSettingsCacheKey(settings, PREPROCESS_CACHE_SETTING_DEPENDENCIES);
}

function createLinkPreprocessSettingsKey(settings: PluginSettings): string {
	return createSettingsCacheKey(settings, LINK_PREPROCESS_CACHE_SETTING_DEPENDENCIES);
}

function createTagPreprocessSettingsKey(settings: PluginSettings): string {
	return createSettingsCacheKey(settings, TAG_PREPROCESS_CACHE_SETTING_DEPENDENCIES);
}

function getLinkPreprocessedDisplayData(
	displayDataBuilder: DisplayDataBuilder,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	cache: PreprocessedDisplayDataCache,
): LinkPreprocessedDisplayData {
	const preprocessSettingsKey = createLinkPreprocessSettingsKey(settings);
	const branchesRef = linkResult?.branches;
	const backlinksRef = linkResult?.backlinks;
	const cached = cache.linkEntry;

	if (
		cached &&
		cached.branchesRef === branchesRef &&
		cached.backlinksRef === backlinksRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.preprocessed;
	}

	const preprocessed = displayDataBuilder.preprocessLinkDisplayData(
		linkResult,
		settings,
	);

	cache.linkEntry = {
		branchesRef,
		backlinksRef,
		preprocessSettingsKey,
		preprocessed,
	};

	return preprocessed;
}

function getTagPreprocessedDisplayData(
	displayDataBuilder: DisplayDataBuilder,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	cache: PreprocessedDisplayDataCache,
): TagPreprocessedDisplayData {
	const preprocessSettingsKey = createTagPreprocessSettingsKey(settings);
	const taggedNotesRef = linkResult?.taggedNotes;
	const cached = cache.tagEntry;

	if (
		cached &&
		cached.taggedNotesRef === taggedNotesRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.preprocessed;
	}

	const preprocessed = displayDataBuilder.preprocessTagDisplayData(
		linkResult,
		settings,
	);

	cache.tagEntry = {
		taggedNotesRef,
		preprocessSettingsKey,
		preprocessed,
	};

	return preprocessed;
}

function getDedupePreprocessedDisplayData(
	displayDataBuilder: DisplayDataBuilder,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	cache: PreprocessedDisplayDataCache,
	preprocessSettingsKey: string,
): PreprocessedDisplayData {
	const branchesRef = linkResult?.branches;
	const backlinksRef = linkResult?.backlinks;
	const taggedNotesRef = linkResult?.taggedNotes;
	const cached = cache.combinedEntry;

	if (
		cached &&
		cached.branchesRef === branchesRef &&
		cached.backlinksRef === backlinksRef &&
		cached.taggedNotesRef === taggedNotesRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.preprocessed;
	}

	const preprocessed = displayDataBuilder.preprocessDisplayData(linkResult, settings);

	cache.combinedEntry = {
		branchesRef,
		backlinksRef,
		taggedNotesRef,
		linkPreprocessed: preprocessed,
		tagPreprocessed: preprocessed,
		preprocessSettingsKey,
		preprocessed,
	};

	return preprocessed;
}

export function computePreprocessedDisplayDataState(
	displayDataBuilder: DisplayDataBuilder,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	cache: PreprocessedDisplayDataCache,
): ComputedPreprocessedDisplayData {
	const preprocessSettingsKey = createPreprocessSettingsKey(settings);
	const cachedCombined = cache.combinedEntry;
	let preprocessed: PreprocessedDisplayData;

	if (
		cachedCombined &&
		cachedCombined.branchesRef === linkResult?.branches &&
		cachedCombined.backlinksRef === linkResult?.backlinks &&
		cachedCombined.taggedNotesRef === linkResult?.taggedNotes &&
		cachedCombined.preprocessSettingsKey === preprocessSettingsKey
	) {
		return {
			preprocessed: cachedCombined.preprocessed,
		};
	}

	if (settings.dedupeCards) {
		return {
			preprocessed: getDedupePreprocessedDisplayData(
				displayDataBuilder,
				linkResult,
				settings,
				cache,
				preprocessSettingsKey,
			),
		};
	}

	const linkPreprocessed = getLinkPreprocessedDisplayData(
		displayDataBuilder,
		linkResult,
		settings,
		cache,
	);
	const tagPreprocessed = getTagPreprocessedDisplayData(
		displayDataBuilder,
		linkResult,
		settings,
		cache,
	);
	const cached = cache.combinedEntry;

	if (
		cached &&
		cached.linkPreprocessed === linkPreprocessed &&
		cached.tagPreprocessed === tagPreprocessed &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return {
			preprocessed: cached.preprocessed,
		};
	}

	preprocessed = {
		...linkPreprocessed,
		...tagPreprocessed,
	};

	cache.combinedEntry = {
		branchesRef: linkResult?.branches,
		backlinksRef: linkResult?.backlinks,
		taggedNotesRef: linkResult?.taggedNotes,
		linkPreprocessed,
		tagPreprocessed,
		preprocessSettingsKey,
		preprocessed,
	};

	return {
		preprocessed,
	};
}

export function computeSortedDisplayDataState(
	displayDataBuilder: DisplayDataBuilder,
	preprocessedState: ComputedPreprocessedDisplayData,
	settings: PluginSettings,
	sortOption: SortOption,
): ComputedDisplayData {
	const displayData = displayDataBuilder.sortAndAssembleDisplayData(
		preprocessedState.preprocessed,
		settings,
		sortOption,
	);

	return {
		displayData,
		hasDisplayableItems: hasDisplayableItems(displayData, settings),
	};
}

function hasDisplayableItems(
	displayData: DisplayData,
	settings: PluginSettings,
): boolean {
	return (
		displayData.mergedItems.length > 0 ||
		displayData.outgoing.length > 0 ||
		displayData.backlinks.length > 0 ||
		displayData.twoHopBranches.length > 0 ||
		((settings?.showTagsSection ?? true) && displayData.tagGroups.length > 0) ||
		displayData.newLinks.length > 0
	);
}
