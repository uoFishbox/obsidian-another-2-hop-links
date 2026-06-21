import type { ViewItem } from "application/presenters";
import { fromViewItem, getViewItemPath } from "application/presenters";
import type { SortableItem } from "core/sorting";
import type { SortOption } from "types/settings";
import type { ISortService } from "types/services";

export type ViewItemSortCache = Map<string, WeakMap<ViewItem[], ViewItem[]>>;

export interface BookmarkedViewItemOrder {
	filePaths: { size: number };
	orderedFilePaths: readonly string[];
	isBookmarked: (path: string | null | undefined) => boolean;
}

function hasSameRawItemOrder(
	original: readonly SortableItem[],
	sorted: readonly SortableItem[],
): boolean {
	if (original.length !== sorted.length) {
		return false;
	}

	for (let index = 0; index < original.length; index += 1) {
		if (original[index] !== sorted[index]) {
			return false;
		}
	}

	return true;
}

function createSortCacheKey(
	sortOption: SortOption,
	sortSettingsSignature: string,
): string {
	return `${sortSettingsSignature}|${sortOption}`;
}

export function createViewItemSortCache(): ViewItemSortCache {
	return new Map();
}

export function sortViewItems(
	viewItems: ViewItem[],
	option: SortOption,
	sortService: ISortService,
	fallbackFactory?: (raw: SortableItem) => ViewItem,
): ViewItem[] {
	if (viewItems.length <= 1) {
		return viewItems;
	}

	const itemMap = new Map<SortableItem, ViewItem[]>();
	const rawItems: SortableItem[] = new Array(viewItems.length);

	for (let index = 0; index < viewItems.length; index += 1) {
		const viewItem = viewItems[index];
		const raw = fromViewItem(viewItem);
		rawItems[index] = raw;
		const existing = itemMap.get(raw) ?? [];
		existing.push(viewItem);
		itemMap.set(raw, existing);
	}

	const sortedRaw = sortService.sort(rawItems, option);
	if (hasSameRawItemOrder(rawItems, sortedRaw)) {
		return viewItems;
	}

	const sortedItems = new Array<ViewItem>(sortedRaw.length);
	for (let index = 0; index < sortedRaw.length; index += 1) {
		const raw = sortedRaw[index];
		const bucket = itemMap.get(raw);
		if (!bucket || bucket.length === 0) {
			if (!fallbackFactory) {
				throw new Error("Missing fallback view item factory");
			}
			sortedItems[index] = fallbackFactory(raw);
			continue;
		}

		const next = bucket.shift();
		if (bucket.length > 0) {
			itemMap.set(raw, bucket);
		} else {
			itemMap.delete(raw);
		}
		sortedItems[index] = next!;
	}
	return sortedItems;
}

export function getSortedViewItemsWithCache(
	viewItems: ViewItem[],
	option: SortOption,
	sortSettingsSignature: string,
	sortService: ISortService,
	cache: ViewItemSortCache,
	fallbackFactory?: (raw: SortableItem) => ViewItem,
): ViewItem[] {
	if (viewItems.length <= 1) {
		return viewItems;
	}

	const cacheKey = createSortCacheKey(option, sortSettingsSignature);
	const cachedSortedItemsByKey = cache.get(cacheKey) ?? new WeakMap();
	if (!cache.has(cacheKey)) {
		cache.set(cacheKey, cachedSortedItemsByKey);
	}

	const cached = cachedSortedItemsByKey.get(viewItems);
	if (cached) {
		return cached;
	}

	const sortedItems = sortViewItems(
		viewItems,
		option,
		sortService,
		fallbackFactory,
	);
	cachedSortedItemsByKey.set(viewItems, sortedItems);
	return sortedItems;
}

export function pinBookmarkedViewItems(
	viewItems: ViewItem[],
	bookmarks: BookmarkedViewItemOrder,
): ViewItem[] {
	const bookmarked = new Map<string, ViewItem>();
	const others: ViewItem[] = [];

	for (const item of viewItems) {
		const path = getViewItemPath(item);
		if (path && bookmarks.isBookmarked(path)) {
			bookmarked.set(path, item);
		} else {
			others.push(item);
		}
	}

	if (bookmarked.size === 0) {
		return viewItems;
	}

	// SvelteSet の変更を検知して再評価されるように size にアクセス
	void bookmarks.filePaths.size;
	const orderedBookmarked: ViewItem[] = [];
	for (const path of bookmarks.orderedFilePaths) {
		const item = bookmarked.get(path);
		if (!item) {
			continue;
		}

		orderedBookmarked.push(item);
		bookmarked.delete(path);
	}

	for (const item of bookmarked.values()) {
		orderedBookmarked.push(item);
	}

	return [...orderedBookmarked, ...others];
}
