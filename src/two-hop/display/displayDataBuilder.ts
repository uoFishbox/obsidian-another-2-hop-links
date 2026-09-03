import type { IndexedLink } from "indexing/model";
import type { TwoHopLinkBranch, TwoHopLinkResult } from "two-hop/model";
import type { TaggedNote } from "indexing/model";
import type { TagGroup } from "two-hop/model";
import type { PluginSettings } from "settings/model";
import type { ISortService, SortableItem, SortOption } from "cards/sorting";
import { sortOneHopByRelevance, type GetRelevanceLinkTargets } from "./relevanceSort";
import {
	createDisplayAssemblyCacheKey,
	selectDisplayAssemblySettings,
} from "two-hop/display/displayCacheDependencies";
import {
	preprocessLinkDisplayData,
	preprocessTagDisplayData,
	type LinkPreprocessingResult,
	type MergedLinkItem,
	type PreprocessedDisplayData,
	type TagPreprocessedDisplayData,
} from "./displayDataPreprocessor";

export type {
	LinkPreprocessedDisplayData,
	LinkPreprocessingResult,
	MergedLinkItem,
	PreprocessedDisplayData,
	TagPreprocessedDisplayData,
} from "./displayDataPreprocessor";

export interface DisplayData {
	readonly outgoing: readonly TwoHopLinkBranch[];
	readonly backlinks: readonly IndexedLink[];
	readonly mergedItems: readonly MergedLinkItem[];
	readonly twoHopBranches: readonly TwoHopLinkBranch[];
	readonly tagGroups: readonly TagGroup[];
	readonly newLinks: readonly IndexedLink[];
}

export interface DisplayDataBuilder {
	preprocessLinkDisplayData(
		linkResult: TwoHopLinkResult | undefined,
		settings: PluginSettings,
	): LinkPreprocessingResult;
	preprocessTagDisplayData(
		linkResult: TwoHopLinkResult | undefined,
		settings: PluginSettings,
		initialState: import("two-hop/display/deduplication/usageTracker").DedupState,
	): TagPreprocessedDisplayData;
	sortAndAssembleDisplayData(
		preprocessed: PreprocessedDisplayData,
		settings: PluginSettings,
		sortOption: SortOption,
	): DisplayData;
	getSortedTwoHopItems(
		items: readonly IndexedLink[],
		sortOption: SortOption,
	): readonly IndexedLink[];
	getSortedTagGroupItems(
		items: readonly TaggedNote[],
		sortOption: SortOption,
	): readonly TaggedNote[];
	getSortContextVersion(): number;
}

export interface DisplayDataBuilderDependencies {
	sortService: ISortService;
	getLinkTargets: GetRelevanceLinkTargets;
	getSortContextVersion?: () => number;
}

type ItemSortCache = Map<
	SortOption,
	WeakMap<readonly SortableItem[], readonly SortableItem[]>
>;

type DisplayAssemblyCache = WeakMap<PreprocessedDisplayData, Map<string, DisplayData>>;

/** Owns display assembly and lazy item sorting for the current sort context. */
export function createDisplayDataBuilder(
	dependencies: DisplayDataBuilderDependencies,
): DisplayDataBuilder {
	const { sortService, getLinkTargets, getSortContextVersion } = dependencies;
	let displayAssemblyCache: DisplayAssemblyCache = new WeakMap();
	const itemSortCache: ItemSortCache = new Map();
	const resolveSortContextVersion = (): number => getSortContextVersion?.() ?? 0;
	let lastSortContextVersion = resolveSortContextVersion();

	function syncSortContextCaches(): void {
		const currentSortContextVersion = resolveSortContextVersion();
		if (currentSortContextVersion === lastSortContextVersion) {
			return;
		}

		lastSortContextVersion = currentSortContextVersion;
		displayAssemblyCache = new WeakMap();
		itemSortCache.clear();
	}

	function getSortedItems<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): readonly T[] {
		if (items.length <= 1) return items;
		const option =
			sortOption === "relevance" ? "modified-date-reverse" : sortOption;
		let cache = itemSortCache.get(option);
		if (!cache) {
			cache = new WeakMap();
			itemSortCache.set(option, cache);
		}
		const cached = cache.get(items) as readonly T[] | undefined;
		if (cached) return cached;

		const sorted = sortService.sort(items, option);
		const result =
			sorted === items ||
			(sorted.length === items.length &&
				sorted.every((item, index) => item === items[index]))
				? items
				: sorted;
		cache.set(items, result);
		return result;
	}

	function getSortedGroupItems<T extends IndexedLink | TaggedNote>(
		items: readonly T[],
		sortOption: SortOption,
	): readonly T[] {
		syncSortContextCaches();
		return getSortedItems(items, sortOption);
	}

	function sortAndAssembleDisplayData(
		preprocessed: PreprocessedDisplayData,
		settings: PluginSettings,
		sortOption: SortOption,
	): DisplayData {
		syncSortContextCaches();
		const assemblyKey = createDisplayAssemblyCacheKey(settings, sortOption);
		let cache = displayAssemblyCache.get(preprocessed);
		const cached = cache?.get(assemblyKey);
		if (cached) return cached;

		const assemblySettings = selectDisplayAssemblySettings(settings);
		const sortedNewLinks = getSortedItems(preprocessed.newLinks, sortOption);
		const sortOneHopItems = <T extends MergedLinkItem>(
			items: readonly T[],
		): readonly T[] =>
			sortOption === "relevance"
				? sortOneHopByRelevance(
						items,
						preprocessed.originPath,
						getLinkTargets,
						sortService,
					)
				: getSortedItems(items, sortOption);

		let outgoing: readonly TwoHopLinkBranch[] = [];
		let backlinks: readonly IndexedLink[] = [];
		let mergedItems: readonly MergedLinkItem[] = [];
		if (assemblySettings.useMergedLinksSection) {
			mergedItems = sortOneHopItems(preprocessed.mergedBaseItems);
		} else {
			outgoing = sortOneHopItems(preprocessed.resolvedBranches);
			backlinks = sortOneHopItems(preprocessed.resolvedBacklinks);
		}
		const displayData: DisplayData = {
			outgoing,
			backlinks,
			mergedItems,
			twoHopBranches: preprocessed.nonEmptyTwoHopBranches,
			tagGroups: assemblySettings.showTagsSection
				? preprocessed.rawTagGroups
				: [],
			newLinks: sortedNewLinks,
		};
		if (!cache) {
			cache = new Map();
			displayAssemblyCache.set(preprocessed, cache);
		}
		cache.set(assemblyKey, displayData);
		return displayData;
	}

	return {
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData,
		getSortedTwoHopItems: getSortedGroupItems,
		getSortedTagGroupItems: getSortedGroupItems,
		getSortContextVersion: resolveSortContextVersion,
	};
}
