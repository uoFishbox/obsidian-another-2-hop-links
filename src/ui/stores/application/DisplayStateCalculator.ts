import type {
	DisplayDataBuilder,
	DisplayData,
	LinkPreprocessedDisplayData,
	LinkPreprocessingResult,
	PreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "features/two-hop/application/displayDataBuilder";
import type { TwoHopLinkResult } from "types";
import type { DedupState } from "types/deduplication";
import type { PluginSettings, SortOption } from "features/settings/model";
import {
	createLinkPreprocessCacheKey,
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
	assemblyEntry: PreprocessedDisplayDataAssemblyCacheEntry | undefined;
}

interface LinkPreprocessedDisplayDataCacheEntry {
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
	computed: ComputedPreprocessedDisplayData;
}

export function createPreprocessedDisplayDataCache(): PreprocessedDisplayDataCache {
	return {
		linkEntry: undefined,
		tagEntry: undefined,
		assemblyEntry: undefined,
	};
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
): LinkPreprocessingResult {
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
		return cached.result;
	}

	const result = displayDataBuilder.preprocessLinkDisplayData(linkResult, settings);

	cache.linkEntry = {
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
	const preprocessSettingsKey = createTagPreprocessSettingsKey(settings);
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
): ComputedPreprocessedDisplayData {
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
		return cached.computed;
	}

	const preprocessed: PreprocessedDisplayData = {
		...linkPreprocessed,
		...tagPreprocessed,
	};

	const computed = { preprocessed };
	cache.assemblyEntry = {
		linkPreprocessed,
		tagPreprocessed,
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
