import { fromCardItem, getCardItemPath, type CardItem } from "cards/CardItem";
import type { ISortService, SortableItem, SortOption } from "cards/sorting";

interface DuplicateViewItemBucket {
	readonly items: CardItem[];
	nextIndex: number;
}

type ViewItemBucket = CardItem | DuplicateViewItemBucket;

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

export function getSortedViewItems(
	viewItems: CardItem[],
	option: SortOption,
	sortService: ISortService,
	fallbackFactory?: (raw: SortableItem) => CardItem,
): CardItem[] {
	if (viewItems.length <= 1) {
		return viewItems;
	}

	const itemMap = new Map<SortableItem, ViewItemBucket>();
	const rawItems: SortableItem[] = new Array(viewItems.length);

	for (let index = 0; index < viewItems.length; index += 1) {
		const viewItem = viewItems[index];
		const raw = fromCardItem(viewItem);
		rawItems[index] = raw;
		const existing = itemMap.get(raw);
		if (!existing) {
			itemMap.set(raw, viewItem);
		} else if ("items" in existing) {
			existing.items.push(viewItem);
		} else {
			itemMap.set(raw, { items: [existing, viewItem], nextIndex: 0 });
		}
	}

	const sortedRaw = sortService.sort(rawItems, option);
	if (sortedRaw === rawItems || hasSameRawItemOrder(rawItems, sortedRaw)) {
		return viewItems;
	}

	const sortedItems = new Array<CardItem>(sortedRaw.length);
	for (let index = 0; index < sortedRaw.length; index += 1) {
		const raw = sortedRaw[index];
		const bucket = itemMap.get(raw);
		if (!bucket) {
			if (!fallbackFactory) {
				throw new Error("Missing fallback view item factory");
			}
			sortedItems[index] = fallbackFactory(raw);
			continue;
		}

		if ("items" in bucket) {
			sortedItems[index] = bucket.items[bucket.nextIndex++];
			if (bucket.nextIndex >= bucket.items.length) {
				itemMap.delete(raw);
			}
		} else {
			sortedItems[index] = bucket;
			itemMap.delete(raw);
		}
	}
	return sortedItems;
}

export function pinBookmarkedViewItems(
	viewItems: CardItem[],
	bookmarks: BookmarkedViewItemOrder,
): CardItem[] {
	if (bookmarks.filePaths.size === 0) {
		return viewItems;
	}

	const bookmarked = new Map<string, CardItem>();
	const others: CardItem[] = [];

	for (const item of viewItems) {
		const path = getCardItemPath(item);
		if (path && bookmarks.isBookmarked(path)) {
			bookmarked.set(path, item);
		} else {
			others.push(item);
		}
	}

	if (bookmarked.size === 0) {
		return viewItems;
	}

	const orderedBookmarked: CardItem[] = [];
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
