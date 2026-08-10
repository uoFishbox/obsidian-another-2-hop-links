import type {
	DisplayDataBuilder,
	DisplayData,
	LinkPreprocessedDisplayData,
	PreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "features/two-hop/application/displayDataBuilder";
import type { TwoHopLinkResult } from "types";
import type { PluginSettings, SortOption } from "features/settings/model";
import {
	createLinkPreprocessCacheKey,
	createPreprocessCacheKey,
	createTagPreprocessCacheKey,
	selectTagDisplayPreprocessSettings,
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
	taggedNotesInputRef: TwoHopLinkResult["taggedNotes"] | undefined;
	preprocessSettingsKey: string;
	preprocessed: TagPreprocessedDisplayData;
}

interface CombinedPreprocessedDisplayDataCacheEntry {
	branchesRef: TwoHopLinkResult["branches"] | undefined;
	backlinksRef: TwoHopLinkResult["backlinks"] | undefined;
	taggedNotesInputRef: TwoHopLinkResult["taggedNotes"] | undefined;
	linkPreprocessed: LinkPreprocessedDisplayData;
	tagPreprocessed: TagPreprocessedDisplayData;
	preprocessSettingsKey: string;
	computed: ComputedPreprocessedDisplayData;
}

export function createPreprocessedDisplayDataCache(): PreprocessedDisplayDataCache {
	return {
		linkEntry: undefined,
		tagEntry: undefined,
		combinedEntry: undefined,
	};
}

function createPreprocessSettingsKey(settings: PluginSettings): string {
	return createPreprocessCacheKey(settings);
}

function createLinkPreprocessSettingsKey(settings: PluginSettings): string {
	return createLinkPreprocessCacheKey(settings);
}

function createTagPreprocessSettingsKey(settings: PluginSettings): string {
	return createTagPreprocessCacheKey(settings);
}

function getTaggedNotesInputRef(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
): TwoHopLinkResult["taggedNotes"] | undefined {
	const tagSettings = selectTagDisplayPreprocessSettings(settings);
	if (!tagSettings.tagFeaturesEnabled || !tagSettings.showTagsSection) {
		return undefined;
	}
	return linkResult?.taggedNotes;
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
	const taggedNotesInputRef = getTaggedNotesInputRef(linkResult, settings);
	const cached = cache.tagEntry;

	if (
		cached &&
		cached.taggedNotesInputRef === taggedNotesInputRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.preprocessed;
	}

	const preprocessed = displayDataBuilder.preprocessTagDisplayData(
		linkResult,
		settings,
	);

	cache.tagEntry = {
		taggedNotesInputRef,
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
): ComputedPreprocessedDisplayData {
	const branchesRef = linkResult?.branches;
	const backlinksRef = linkResult?.backlinks;
	const taggedNotesInputRef = getTaggedNotesInputRef(linkResult, settings);
	const cached = cache.combinedEntry;

	if (
		cached &&
		cached.branchesRef === branchesRef &&
		cached.backlinksRef === backlinksRef &&
		cached.taggedNotesInputRef === taggedNotesInputRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.computed;
	}

	const preprocessed = displayDataBuilder.preprocessDisplayData(linkResult, settings);

	const computed = { preprocessed };
	cache.combinedEntry = {
		branchesRef,
		backlinksRef,
		taggedNotesInputRef,
		linkPreprocessed: preprocessed,
		tagPreprocessed: preprocessed,
		preprocessSettingsKey,
		computed,
	};

	return computed;
}

export function computePreprocessedDisplayDataState(
	displayDataBuilder: DisplayDataBuilder,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	cache: PreprocessedDisplayDataCache,
): ComputedPreprocessedDisplayData {
	const preprocessSettingsKey = createPreprocessSettingsKey(settings);
	const taggedNotesInputRef = getTaggedNotesInputRef(linkResult, settings);
	const cachedCombined = cache.combinedEntry;
	let preprocessed: PreprocessedDisplayData;

	if (
		cachedCombined &&
		cachedCombined.branchesRef === linkResult?.branches &&
		cachedCombined.backlinksRef === linkResult?.backlinks &&
		cachedCombined.taggedNotesInputRef === taggedNotesInputRef &&
		cachedCombined.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cachedCombined.computed;
	}

	if (settings.dedupeCards) {
		return getDedupePreprocessedDisplayData(
			displayDataBuilder,
			linkResult,
			settings,
			cache,
			preprocessSettingsKey,
		);
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
		return cached.computed;
	}

	preprocessed = {
		...linkPreprocessed,
		...tagPreprocessed,
	};

	const computed = { preprocessed };
	cache.combinedEntry = {
		branchesRef: linkResult?.branches,
		backlinksRef: linkResult?.backlinks,
		taggedNotesInputRef,
		linkPreprocessed,
		tagPreprocessed,
		preprocessSettingsKey,
		computed,
	};

	return computed;
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
