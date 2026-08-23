import type {
	TwoHopIndexedLink,
	TwoHopLinkBranch,
	TwoHopLinkResult,
} from "types/domain";
import type { TaggedNote, TagGroup } from "types/domain";
import type { PluginSettings } from "features/settings/model";
import type { ISortService, SortableItem, SortOption } from "core/sorting";
import {
	createDisplayAssemblyCacheKey,
	selectDisplayAssemblySettings,
} from "features/two-hop/application/displayCacheDependencies";
import {
	preprocessLinkDisplayData,
	preprocessTagDisplayData,
	type LinkPreprocessedDisplayData,
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
	readonly backlinks: readonly TwoHopIndexedLink[];
	readonly mergedItems: readonly MergedLinkItem[];
	readonly twoHopBranches: readonly TwoHopLinkBranch[];
	readonly tagGroups: readonly TagGroup[];
	readonly newLinks: readonly TwoHopIndexedLink[];
}

export interface DisplayDataBuilder {
	preprocessLinkDisplayData(
		linkResult: TwoHopLinkResult | undefined,
		settings: PluginSettings,
	): LinkPreprocessingResult;
	preprocessTagDisplayData(
		linkResult: TwoHopLinkResult | undefined,
		settings: PluginSettings,
		initialState: import("types/deduplication").DedupState,
	): TagPreprocessedDisplayData;
	sortAndAssembleDisplayData(
		preprocessed: PreprocessedDisplayData,
		settings: PluginSettings,
		sortOption: SortOption,
	): DisplayData;
	getSortedTwoHopItems(
		items: readonly TwoHopIndexedLink[],
		sortOption: SortOption,
	): readonly TwoHopIndexedLink[];
	getSortedTagGroupItems(
		items: readonly TaggedNote[],
		sortOption: SortOption,
	): readonly TaggedNote[];
	getSortContextVersion(): number;
}

export interface DisplayDataBuilderDependencies {
	sortService: ISortService;
	getSortContextVersion?: () => number;
}

type ItemSortCache = Map<
	string,
	WeakMap<readonly SortableItem[], readonly SortableItem[]>
>;

type Hop2SortCache = ItemSortCache;
type TagItemSortCache = ItemSortCache;
type DisplayAssemblyCache = WeakMap<PreprocessedDisplayData, Map<string, DisplayData>>;

function createHop2SortCache(): Hop2SortCache {
	return new Map();
}

function createTagItemSortCache(): TagItemSortCache {
	return new Map();
}

function createDisplayAssemblyCache(): DisplayAssemblyCache {
	return new WeakMap();
}

function sortIfNeeded<T extends SortableItem>(
	items: readonly T[],
	sortService: ISortService,
	sortOption: SortOption,
): readonly T[] {
	if (items.length <= 1) {
		return items;
	}
	return sortService.sort(items, sortOption);
}

function sortWithOriginalOrderReuse<T extends SortableItem>(
	items: readonly T[],
	sortService: ISortService,
	sortOption: SortOption,
): readonly T[] {
	if (items.length <= 1) {
		return items;
	}

	const sortedResult = sortIfNeeded(items, sortService, sortOption);
	return sortedResult === items || hasSameItemOrder(items, sortedResult)
		? items
		: sortedResult;
}

function hasSameItemOrder<T>(original: readonly T[], sorted: readonly T[]): boolean {
	if (original.length !== sorted.length) {
		return false;
	}

	for (let i = 0; i < original.length; i += 1) {
		if (original[i] !== sorted[i]) {
			return false;
		}
	}

	return true;
}

function createSortCacheKey(
	sortOption: SortOption,
	sortContextVersion: number,
): string {
	return `${sortContextVersion}\u0000${sortOption}`;
}

function getSortedItemsWithCache<T extends SortableItem>(
	items: readonly T[],
	sortService: ISortService,
	sortOption: SortOption,
	itemSortCache: ItemSortCache,
	sortContextVersion = 0,
): readonly T[] {
	if (items.length <= 1) {
		return items;
	}

	const sortCacheKey = createSortCacheKey(sortOption, sortContextVersion);
	let cachedSortedItemsByOption = itemSortCache.get(sortCacheKey);
	if (!cachedSortedItemsByOption) {
		cachedSortedItemsByOption = new WeakMap();
		itemSortCache.set(sortCacheKey, cachedSortedItemsByOption);
	}

	let sortedItems = cachedSortedItemsByOption.get(items) as readonly T[] | undefined;
	if (!sortedItems) {
		sortedItems = sortWithOriginalOrderReuse(items, sortService, sortOption);
		cachedSortedItemsByOption.set(items, sortedItems);
	}

	return sortedItems;
}

function sortAndAssembleDisplayData(
	preprocessed: PreprocessedDisplayData,
	settings: PluginSettings,
	sortOption: SortOption,
	sortService: ISortService,
	hop2SortCache: Hop2SortCache = createHop2SortCache(),
	displayAssemblyCache: DisplayAssemblyCache = createDisplayAssemblyCache(),
	sortContextVersion = 0,
): DisplayData {
	const assemblySettings = selectDisplayAssemblySettings(settings);
	const assemblyKey = createDisplayAssemblyCacheKey(
		settings,
		sortOption,
		sortContextVersion,
	);
	const cachedDisplayData = displayAssemblyCache.get(preprocessed)?.get(assemblyKey);
	if (cachedDisplayData) {
		return cachedDisplayData;
	}

	const sortedNewLinks = getSortedItemsWithCache(
		preprocessed.newLinks,
		sortService,
		sortOption,
		hop2SortCache,
		sortContextVersion,
	);

	let sortedOutgoing: readonly TwoHopLinkBranch[] = [];
	let sortedBacklinks: readonly TwoHopIndexedLink[] = [];
	let sortedMergedItems: readonly MergedLinkItem[] = [];

	if (assemblySettings.useMergedLinksSection) {
		sortedMergedItems = getSortedItemsWithCache(
			preprocessed.mergedBaseItems,
			sortService,
			sortOption,
			hop2SortCache,
			sortContextVersion,
		);
	} else {
		sortedOutgoing = getSortedItemsWithCache(
			preprocessed.resolvedBranches,
			sortService,
			sortOption,
			hop2SortCache,
			sortContextVersion,
		);
		sortedBacklinks = getSortedItemsWithCache(
			preprocessed.resolvedBacklinks,
			sortService,
			sortOption,
			hop2SortCache,
			sortContextVersion,
		);
	}

	let tagGroups: readonly TagGroup[] = [];
	if (assemblySettings.showTagsSection) {
		tagGroups = preprocessed.rawTagGroups;
	}

	const displayData: DisplayData = {
		outgoing: sortedOutgoing,
		backlinks: sortedBacklinks,
		mergedItems: sortedMergedItems,
		twoHopBranches: preprocessed.nonEmptyTwoHopBranches,
		tagGroups,
		newLinks: sortedNewLinks,
	};

	const cachedDisplayDataByKey = displayAssemblyCache.get(preprocessed) ?? new Map();
	if (!displayAssemblyCache.has(preprocessed)) {
		displayAssemblyCache.set(preprocessed, cachedDisplayDataByKey);
	}
	cachedDisplayDataByKey.set(assemblyKey, displayData);

	return displayData;
}

export function createDisplayDataBuilder(
	dependencies: DisplayDataBuilderDependencies,
): DisplayDataBuilder {
	const { sortService, getSortContextVersion } = dependencies;
	let displayAssemblyCache = createDisplayAssemblyCache();
	let hop2SortCache = createHop2SortCache();
	let tagItemSortCache = createTagItemSortCache();
	const resolveSortContextVersion = (): number => getSortContextVersion?.() ?? 0;
	let lastSortContextVersion = resolveSortContextVersion();
	const syncSortContextCaches = (): number => {
		const currentSortContextVersion = resolveSortContextVersion();
		if (currentSortContextVersion === lastSortContextVersion) {
			return currentSortContextVersion;
		}

		lastSortContextVersion = currentSortContextVersion;
		displayAssemblyCache = createDisplayAssemblyCache();
		hop2SortCache = createHop2SortCache();
		tagItemSortCache = createTagItemSortCache();
		return currentSortContextVersion;
	};
	const sortAndAssembleStage = (
		preprocessed: PreprocessedDisplayData,
		settings: PluginSettings,
		sortOption: SortOption,
	): DisplayData => {
		const sortContextVersion = syncSortContextCaches();
		return sortAndAssembleDisplayData(
			preprocessed,
			settings,
			sortOption,
			sortService,
			hop2SortCache,
			displayAssemblyCache,
			sortContextVersion,
		);
	};

	return {
		preprocessLinkDisplayData,
		preprocessTagDisplayData,
		sortAndAssembleDisplayData: sortAndAssembleStage,
		getSortedTwoHopItems: (
			items: readonly TwoHopIndexedLink[],
			sortOption: SortOption,
		): readonly TwoHopIndexedLink[] => {
			const sortContextVersion = syncSortContextCaches();
			return getSortedItemsWithCache(
				items,
				sortService,
				sortOption,
				hop2SortCache,
				sortContextVersion,
			);
		},
		getSortedTagGroupItems: (
			items: readonly TaggedNote[],
			sortOption: SortOption,
		): readonly TaggedNote[] => {
			const sortContextVersion = syncSortContextCaches();
			return getSortedItemsWithCache(
				items,
				sortService,
				sortOption,
				tagItemSortCache,
				sortContextVersion,
			);
		},
		getSortContextVersion: resolveSortContextVersion,
	};
}
