import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { buildScopedSectionId } from "ui/components/common/listPagination";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";

const EMPTY_HEADER_PROPS: ClickableHeaderExtraProps = {};
let nextSectionDataRevision = 1;

export interface CachedVirtualItemAccessors {
	readonly getItems: () => readonly TwoHopVirtualListItem[];
	readonly getItem: (index: number) => TwoHopVirtualListItem | undefined;
	readonly reset: () => void;
}

export interface LazySortedVirtualItemAccessorsParams<T, TViewItem> {
	readonly getLength: () => number;
	readonly getSortedItems: () => readonly T[];
	readonly getKey: (item: T, index: number) => string;
	readonly toViewItem: (item: T) => TViewItem;
	readonly createItem: (
		item: TViewItem,
		key: string,
		index: number,
	) => TwoHopVirtualListItem;
}

export function createDescriptor(
	section: TwoHopVirtualListSection,
	searchQuery: string,
	totalCount: number,
	getItems: () => readonly TwoHopVirtualListItem[],
	getItem: (index: number) => TwoHopVirtualListItem | undefined = (index) =>
		getItems()[index],
	headerProps: ClickableHeaderExtraProps = EMPTY_HEADER_PROPS,
): TwoHopVirtualSectionDescriptor {
	const immutableSection = Object.freeze(section);
	return Object.freeze({
		sourceRevision: createSectionDataRevision(nextSectionDataRevision++),
		section: immutableSection,
		sectionKey: immutableSection.sectionKey,
		title: immutableSection.title,
		sectionId: immutableSection.rawSectionId,
		paginationKey: buildScopedSectionId(immutableSection.rawSectionId, searchQuery),
		totalCount,
		loadedCount: totalCount,
		getItems,
		getItem,
		headerProps,
	});
}

/**
 * Lazily creates items for a dense index range.
 *
 * `createItem` is called at most once for each index until `reset`. Indexes in
 * `[0, getLength())` must always resolve to an item.
 */
export function createLazyVirtualItemAccessors(params: {
	readonly getLength: () => number;
	readonly createItem: (index: number) => TwoHopVirtualListItem;
}): CachedVirtualItemAccessors {
	let itemsCache: TwoHopVirtualListItem[] | undefined;
	const ensureItemsCache = (length: number): TwoHopVirtualListItem[] => {
		if (!itemsCache || itemsCache.length !== length) {
			itemsCache = new Array<TwoHopVirtualListItem>(length);
		}
		return itemsCache;
	};
	const getItem = (index: number): TwoHopVirtualListItem | undefined => {
		const length = params.getLength();
		if (index < 0 || index >= length) return undefined;
		const cache = ensureItemsCache(length);
		const cached = cache[index];
		if (cached !== undefined) return cached;

		const item = params.createItem(index);
		cache[index] = item;
		return item;
	};
	const getItems = (): readonly TwoHopVirtualListItem[] => {
		const length = params.getLength();
		const cache = ensureItemsCache(length);
		for (let index = 0; index < length; index += 1) {
			if (cache[index] !== undefined) continue;
			cache[index] = params.createItem(index);
		}
		return cache;
	};

	return {
		getItems,
		getItem,
		reset() {
			itemsCache = undefined;
		},
	};
}

/**
 * Lazily wraps items from a sorted, dense source.
 *
 * The first item access prepares the complete sorted source because arbitrary
 * sorted-index access requires a stable order. ViewItem, key, and virtual-item
 * allocation remains limited to requested indexes.
 */
export function createLazySortedVirtualItemAccessors<T, TViewItem>(
	params: LazySortedVirtualItemAccessorsParams<T, TViewItem>,
): CachedVirtualItemAccessors {
	let sortedItems: readonly T[] | undefined;
	let viewItems: TViewItem[] | undefined;
	let keys: string[] | undefined;
	const ensureSortedItems = (): readonly T[] =>
		(sortedItems ??= params.getSortedItems());
	const accessors = createLazyVirtualItemAccessors({
		getLength: params.getLength,
		createItem: (index) => {
			const source = ensureSortedItems()[index];
			viewItems ??= [];
			keys ??= [];
			const viewItem =
				viewItems[index] ?? (viewItems[index] = params.toViewItem(source));
			const key = keys[index] ?? (keys[index] = params.getKey(source, index));
			return params.createItem(viewItem, key, index);
		},
	});
	const resetLazyAccessors = accessors.reset;

	return {
		getItems: accessors.getItems,
		getItem: accessors.getItem,
		reset() {
			sortedItems = undefined;
			viewItems = undefined;
			keys = undefined;
			resetLazyAccessors();
		},
	};
}

export function pruneInactiveEntries<T>(
	entries: Map<string, T>,
	activeIds: Set<string>,
): void {
	for (const key of entries.keys()) {
		if (!activeIds.has(key)) entries.delete(key);
	}
}

export function hasSameDescriptorRefs(
	current: readonly TwoHopVirtualSectionDescriptor[],
	next: readonly TwoHopVirtualSectionDescriptor[],
): boolean {
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (current[index] !== next[index]) return false;
	}
	return true;
}
