import type {
	TwoHopLinkResult,
	TwoHopLinkBranch,
	TwoHopIndexedLink,
} from "types/domain";
import type { TaggedNote, TagGroup } from "types/domain";
import type { PluginSettings } from "features/settings/model";
import type { ISortService, SortableItem, SortOption } from "core/sorting";
import { createDedupState } from "core/deduplication/usageTracker";
import type { DedupState } from "types/deduplication";
import {
	deduplicateLinks,
	deduplicateTaggedNotes,
} from "core/deduplication/deduplicationService";
import { groupNotesByTag } from "core/grouping";
import { isAttachment } from "core/rules/fileRules";
import {
	createDisplayAssemblyCacheKey,
	selectDisplayAssemblySettings,
	selectLinkDisplayPreprocessSettings,
	selectTagDisplayPreprocessSettings,
	type LinkDisplayPreprocessSettings,
} from "features/two-hop/application/displayCacheDependencies";

export type MergedLinkItem = TwoHopLinkBranch | TwoHopIndexedLink;

export interface DisplayData {
	readonly outgoing: readonly TwoHopLinkBranch[];
	readonly backlinks: readonly TwoHopIndexedLink[];
	readonly mergedItems: readonly MergedLinkItem[];
	readonly twoHopBranches: readonly TwoHopLinkBranch[];
	readonly tagGroups: readonly TagGroup[];
	readonly newLinks: readonly TwoHopIndexedLink[];
}

export interface PreprocessedDisplayData {
	readonly resolvedBranches: readonly TwoHopLinkBranch[];
	readonly resolvedBacklinks: readonly TwoHopIndexedLink[];
	readonly mergedBaseItems: readonly MergedLinkItem[];
	readonly rawTagGroups: readonly TagGroup[];
	readonly nonEmptyTwoHopBranches: readonly TwoHopLinkBranch[];
	readonly newLinks: readonly TwoHopIndexedLink[];
}

export interface LinkPreprocessedDisplayData {
	readonly resolvedBranches: readonly TwoHopLinkBranch[];
	readonly resolvedBacklinks: readonly TwoHopIndexedLink[];
	readonly mergedBaseItems: readonly MergedLinkItem[];
	readonly nonEmptyTwoHopBranches: readonly TwoHopLinkBranch[];
	readonly newLinks: readonly TwoHopIndexedLink[];
}

export interface TagPreprocessedDisplayData {
	readonly rawTagGroups: readonly TagGroup[];
}

/** Link display data together with the immutable post-link deduplication state. */
export interface LinkPreprocessingResult {
	readonly data: LinkPreprocessedDisplayData;
	readonly state: DedupState;
}

export interface DisplayDataBuilder {
	preprocessLinkDisplayData(
		linkResult: TwoHopLinkResult | undefined,
		settings: PluginSettings,
	): LinkPreprocessingResult;
	preprocessTagDisplayData(
		linkResult: TwoHopLinkResult | undefined,
		settings: PluginSettings,
		initialState: DedupState,
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

function createEmptyLinkPreprocessedDisplayData(): LinkPreprocessedDisplayData {
	return {
		resolvedBranches: [],
		resolvedBacklinks: [],
		mergedBaseItems: [],
		nonEmptyTwoHopBranches: [],
		newLinks: [],
	};
}

function createEmptyTagPreprocessedDisplayData(): TagPreprocessedDisplayData {
	return {
		rawTagGroups: [],
	};
}

function createHop2SortCache(): Hop2SortCache {
	return new Map();
}

function createTagItemSortCache(): TagItemSortCache {
	return new Map();
}

function createDisplayAssemblyCache(): DisplayAssemblyCache {
	return new WeakMap();
}

const NEW_LINK_KEY_SEPARATOR = "\u0000";

function getNewLinkTargetKey(link: TwoHopIndexedLink): string {
	return link.lookupPath ?? link.path ?? link.rawText;
}

function createNewLinkKey(link: TwoHopIndexedLink): string {
	return getNewLinkTargetKey(link) + NEW_LINK_KEY_SEPARATOR + (link.path ?? "");
}

function collectNewLink(
	newLinks: TwoHopIndexedLink[],
	newLinkIndexesByKey: Map<string, number> | undefined,
	link: TwoHopIndexedLink,
): Map<string, number> | undefined {
	if ((link.backlinkCount ?? 0) >= 2) {
		return newLinkIndexesByKey;
	}

	if (!newLinkIndexesByKey && newLinks.length === 0) {
		newLinks.push(link);
		return undefined;
	}

	const key = createNewLinkKey(link);
	const indexesByKey = newLinkIndexesByKey ?? new Map<string, number>();
	if (!newLinkIndexesByKey) {
		indexesByKey.set(createNewLinkKey(newLinks[0]), 0);
	}
	const existingIndex = indexesByKey.get(key);

	if (existingIndex === undefined) {
		indexesByKey.set(key, newLinks.length);
		newLinks.push(link);
		return indexesByKey;
	}

	newLinks[existingIndex] = link;
	return indexesByKey;
}

function collectDisplayBaseData(
	branches: readonly TwoHopLinkBranch[],
	backlinks: readonly TwoHopIndexedLink[],
): Pick<
	LinkPreprocessedDisplayData,
	"resolvedBranches" | "resolvedBacklinks" | "mergedBaseItems" | "newLinks"
> {
	let newLinkIndexesByKey: Map<string, number> | undefined;
	const newLinks: TwoHopIndexedLink[] = [];
	const resolvedBranches: TwoHopLinkBranch[] = [];
	const resolvedBacklinks: TwoHopIndexedLink[] = [];
	const mergedBaseItems: MergedLinkItem[] = [];

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];
		if (branch.hop1.isUnresolved) {
			newLinkIndexesByKey = collectNewLink(
				newLinks,
				newLinkIndexesByKey,
				branch.hop1,
			);
			continue;
		}

		resolvedBranches.push(branch);
		mergedBaseItems.push(branch);
	}

	for (let index = 0; index < backlinks.length; index += 1) {
		const backlink = backlinks[index];
		if (backlink.isUnresolved) {
			newLinkIndexesByKey = collectNewLink(
				newLinks,
				newLinkIndexesByKey,
				backlink,
			);
			continue;
		}

		resolvedBacklinks.push(backlink);
		mergedBaseItems.push(backlink);
	}

	return {
		resolvedBranches,
		resolvedBacklinks,
		mergedBaseItems,
		newLinks,
	};
}

function filterNonEmptyTwoHopBranches(
	branches: readonly TwoHopLinkBranch[],
): readonly TwoHopLinkBranch[] {
	let filteredBranches: TwoHopLinkBranch[] | undefined;

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];

		if (branch.hop2.length === 0) {
			filteredBranches ??= branches.slice(0, index);
			continue;
		}

		filteredBranches?.push(branch);
	}

	return filteredBranches ?? branches;
}

function filterWithReferenceReuse<T>(
	items: readonly T[],
	shouldKeep: (item: T) => boolean,
): readonly T[] {
	let filteredItems: T[] | undefined;

	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (!shouldKeep(item)) {
			filteredItems ??= items.slice(0, index);
			continue;
		}

		filteredItems?.push(item);
	}

	return filteredItems ?? items;
}

function shouldKeepNonAttachmentBacklink(link: TwoHopIndexedLink): boolean {
	return !isAttachment(link.sourceFile.extension);
}

function shouldKeepNonAttachmentBranch(branch: TwoHopLinkBranch): boolean {
	const path = branch.hop1.path;
	if (!path) return true;

	const dotIndex = path.lastIndexOf(".");
	const extension = dotIndex === -1 ? path : path.slice(dotIndex + 1);
	return !isAttachment(extension);
}

function filterBranchHop2Attachments(
	branches: readonly TwoHopLinkBranch[],
): readonly TwoHopLinkBranch[] {
	let filteredBranches: TwoHopLinkBranch[] | undefined;

	for (let index = 0; index < branches.length; index += 1) {
		const branch = branches[index];
		const hop2 = filterWithReferenceReuse(
			branch.hop2,
			shouldKeepNonAttachmentBacklink,
		);

		if (hop2 === branch.hop2) {
			filteredBranches?.push(branch);
			continue;
		}

		filteredBranches ??= branches.slice(0, index);
		filteredBranches.push({
			hop1: branch.hop1,
			hop2,
		});
	}

	return filteredBranches ?? branches;
}

function shouldKeepNonAttachmentTaggedNote(note: TaggedNote): boolean {
	return !isAttachment(note.file.extension);
}

function compareTwoHopBranchesByHop2Count(
	left: TwoHopLinkBranch,
	right: TwoHopLinkBranch,
): number {
	return left.hop2.length - right.hop2.length;
}

function sortTwoHopBranchesIfNeeded(
	branches: readonly TwoHopLinkBranch[],
	settings: LinkDisplayPreprocessSettings,
): readonly TwoHopLinkBranch[] {
	if (settings.twoHopHeaderSortOrder !== "hop2-count-asc" || branches.length < 2) {
		return branches;
	}

	for (let index = 1; index < branches.length; index += 1) {
		if (
			compareTwoHopBranchesByHop2Count(branches[index - 1], branches[index]) > 0
		) {
			return [...branches].sort(compareTwoHopBranchesByHop2Count);
		}
	}

	return branches;
}

function preprocessLinkData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	initialState: DedupState = createDedupState(),
): LinkPreprocessingResult {
	if (!linkResult) {
		return {
			data: createEmptyLinkPreprocessedDisplayData(),
			state: initialState,
		};
	}

	const preprocessSettings = selectLinkDisplayPreprocessSettings(settings);
	let { branches: originalBranches, backlinks: originalBacklinks } = linkResult;

	if (preprocessSettings.excludeAttachments) {
		originalBacklinks = filterWithReferenceReuse(
			originalBacklinks,
			shouldKeepNonAttachmentBacklink,
		);

		originalBranches = filterWithReferenceReuse(
			originalBranches,
			shouldKeepNonAttachmentBranch,
		);
		originalBranches = filterBranchHop2Attachments(originalBranches);
	}

	let branchesForProcessing: readonly TwoHopLinkBranch[];
	let backlinksForProcessing: readonly TwoHopIndexedLink[];
	let twoHopBranchesForProcessing: readonly TwoHopLinkBranch[];

	if (settings.dedupeCards) {
		const result = deduplicateLinks(
			initialState,
			originalBranches,
			originalBacklinks,
		);
		branchesForProcessing = result.data.branches;
		backlinksForProcessing = result.data.backlinks;
		twoHopBranchesForProcessing = result.data.twoHopBranches;
		initialState = result.state;
	} else {
		branchesForProcessing = originalBranches;
		backlinksForProcessing = originalBacklinks;
		twoHopBranchesForProcessing = originalBranches;
	}

	const { resolvedBranches, resolvedBacklinks, mergedBaseItems, newLinks } =
		collectDisplayBaseData(branchesForProcessing, backlinksForProcessing);
	const nonEmptyTwoHopBranches = filterNonEmptyTwoHopBranches(
		twoHopBranchesForProcessing,
	);
	const sortedNonEmptyTwoHopBranches = sortTwoHopBranchesIfNeeded(
		nonEmptyTwoHopBranches,
		preprocessSettings,
	);

	return {
		data: {
			resolvedBranches,
			resolvedBacklinks,
			mergedBaseItems,
			nonEmptyTwoHopBranches: sortedNonEmptyTwoHopBranches,
			newLinks,
		},
		state: initialState,
	};
}

function preprocessTagData(
	linkResult: TwoHopLinkResult | undefined,
	settings: PluginSettings,
	initialState: DedupState,
): TagPreprocessedDisplayData {
	const preprocessSettings = selectTagDisplayPreprocessSettings(settings);
	if (
		!linkResult ||
		!preprocessSettings.tagFeaturesEnabled ||
		!preprocessSettings.showTagsSection
	) {
		return createEmptyTagPreprocessedDisplayData();
	}

	let taggedNotes = linkResult.taggedNotes;
	if (preprocessSettings.excludeAttachments) {
		taggedNotes = filterWithReferenceReuse(
			taggedNotes,
			shouldKeepNonAttachmentTaggedNote,
		);
	}

	if (settings.dedupeCards) {
		const result = deduplicateTaggedNotes(initialState, taggedNotes);
		taggedNotes = result.items;
	}

	return {
		rawTagGroups: groupNotesByTag(taggedNotes),
	};
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

	const displayData = {
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
		preprocessLinkDisplayData: preprocessLinkData,
		preprocessTagDisplayData: preprocessTagData,
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
