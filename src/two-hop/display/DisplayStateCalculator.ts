import type {
	DisplayDataBuilder,
	DisplayData,
	LinkPreprocessedDisplayData,
	LinkPreprocessingResult,
	PreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "two-hop/display/displayDataBuilder";
import type { TwoHopLinkResult } from "two-hop/model";
import type { DedupState } from "two-hop/display/deduplication/usageTracker";
import type { PluginSettings } from "settings/model";
import type { SortOption } from "cards/sorting";
import {
	createLinkPreprocessCacheKey,
	createTagPreprocessCacheKey,
	selectTagDisplayPreprocessSettings,
} from "two-hop/display/displayCacheDependencies";

export interface ComputedDisplayData {
	displayData: DisplayData;
	hasDisplayableItems: boolean;
}

export interface PreprocessedDisplayDataCache {
	linkEntry: LinkPreprocessedDisplayDataCacheEntry | undefined;
	tagEntry: TagPreprocessedDisplayDataCacheEntry | undefined;
	assemblyEntry: PreprocessedDisplayDataAssemblyCacheEntry | undefined;
}

interface LinkPreprocessedDisplayDataCacheEntry {
	originPath: string | undefined;
	branchesRef: TwoHopLinkResult["branches"] | undefined;
	backlinksRef: TwoHopLinkResult["backlinks"] | undefined;
	preprocessSettingsKey: string;
	result: LinkPreprocessingResult;
}

interface TagPreprocessedDisplayDataCacheEntry {
	taggedNotesInputRef: TwoHopLinkResult["taggedNotes"] | undefined;
	dedupStateRef: DedupState | undefined;
	preprocessSettingsKey: string;
	preprocessed: TagPreprocessedDisplayData;
}

interface PreprocessedDisplayDataAssemblyCacheEntry {
	linkPreprocessed: LinkPreprocessedDisplayData;
	tagPreprocessed: TagPreprocessedDisplayData;
	preprocessed: PreprocessedDisplayData;
}

export function createPreprocessedDisplayDataCache(): PreprocessedDisplayDataCache {
	return {
		linkEntry: undefined,
		tagEntry: undefined,
		assemblyEntry: undefined,
	};
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
): LinkPreprocessingResult {
	const preprocessSettingsKey = createLinkPreprocessCacheKey(settings);
	const branchesRef = linkResult?.branches;
	const originPath = linkResult?.originFile.path;
	const backlinksRef = linkResult?.backlinks;
	const cached = cache.linkEntry;

	if (
		cached &&
		cached.originPath === originPath &&
		cached.branchesRef === branchesRef &&
		cached.backlinksRef === backlinksRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.result;
	}

	const result = displayDataBuilder.preprocessLinkDisplayData(linkResult, settings);

	cache.linkEntry = {
		originPath,
		branchesRef,
		backlinksRef,
		preprocessSettingsKey,
		result,
	};

	return result;
}

function getTagPreprocessedDisplayData(
	displayDataBuilder: DisplayDataBuilder,
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	cache: PreprocessedDisplayDataCache,
	linkResultData: LinkPreprocessingResult,
): TagPreprocessedDisplayData {
	const preprocessSettingsKey = createTagPreprocessCacheKey(settings);
	const taggedNotesInputRef = getTaggedNotesInputRef(linkResult, settings);
	const dedupStateRef =
		settings.dedupeCards && taggedNotesInputRef ? linkResultData.state : undefined;
	const cached = cache.tagEntry;

	if (
		cached &&
		cached.taggedNotesInputRef === taggedNotesInputRef &&
		cached.dedupStateRef === dedupStateRef &&
		cached.preprocessSettingsKey === preprocessSettingsKey
	) {
		return cached.preprocessed;
	}

	const preprocessed = displayDataBuilder.preprocessTagDisplayData(
		linkResult,
		settings,
		linkResultData.state,
	);

	cache.tagEntry = {
		taggedNotesInputRef,
		dedupStateRef,
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
): PreprocessedDisplayData {
	const linkResultData = getLinkPreprocessedDisplayData(
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
		linkResultData,
	);
	const linkPreprocessed = linkResultData.data;
	const cached = cache.assemblyEntry;

	if (
		cached &&
		cached.linkPreprocessed === linkPreprocessed &&
		cached.tagPreprocessed === tagPreprocessed
	) {
		return cached.preprocessed;
	}

	const preprocessed: PreprocessedDisplayData = {
		...linkPreprocessed,
		...tagPreprocessed,
	};

	cache.assemblyEntry = {
		linkPreprocessed,
		tagPreprocessed,
		preprocessed,
	};

	return preprocessed;
}

export function computeSortedDisplayDataState(
	displayDataBuilder: DisplayDataBuilder,
	preprocessed: PreprocessedDisplayData,
	settings: PluginSettings,
	sortOption: SortOption,
): ComputedDisplayData {
	const displayData = displayDataBuilder.sortAndAssembleDisplayData(
		preprocessed,
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
