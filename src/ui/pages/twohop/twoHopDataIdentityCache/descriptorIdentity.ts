import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { buildScopedSectionId } from "ui/components/common/listPagination";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
	TwoHopVirtualSectionDescriptor,
} from "../twoHopVirtualListModel";

const EMPTY_HEADER_PROPS: ClickableHeaderExtraProps = {};

export interface CachedVirtualItemAccessors {
	readonly getItems: () => readonly TwoHopVirtualListItem[];
	readonly getItem: (index: number) => TwoHopVirtualListItem | undefined;
	readonly reset: () => void;
}

export interface ReconciledVirtualItemAccessorsParams<T, TViewItem> {
	readonly getLength: () => number;
	readonly getSortedItems: () => readonly T[];
	readonly itemsReconciler: {
		reconcile(items: readonly T[]): readonly TViewItem[];
		getKeys(): readonly string[];
	};
	readonly createItem: (
		item: TViewItem,
		key: string,
		index: number,
	) => TwoHopVirtualListItem | undefined;
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

export function createSparseVirtualItemAccessors(params: {
	readonly getLength: () => number;
	readonly createItem: (index: number) => TwoHopVirtualListItem | undefined;
}): CachedVirtualItemAccessors {
	let itemsCache: TwoHopVirtualListItem[] | undefined;
	const getItem = (index: number): TwoHopVirtualListItem | undefined => {
		const length = params.getLength();
		if (index < 0 || index >= length) return undefined;
		const cached = itemsCache?.[index];
		if (cached) return cached;

		const item = params.createItem(index);
		if (!item) return undefined;
		itemsCache ??= new Array<TwoHopVirtualListItem>(length);
		itemsCache[index] = item;
		return item;
	};
	const getItems = (): readonly TwoHopVirtualListItem[] => {
		const length = params.getLength();
		const cache =
			itemsCache && itemsCache.length === length
				? itemsCache
				: new Array<TwoHopVirtualListItem>(length);
		itemsCache = cache;
		for (let index = 0; index < length; index += 1) {
			if (cache[index]) continue;
			const item = getItem(index);
			if (item) cache[index] = item;
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

export function createReconciledVirtualItemAccessors<T, TViewItem>(
	params: ReconciledVirtualItemAccessorsParams<T, TViewItem>,
): CachedVirtualItemAccessors {
	let reconciledItems: readonly TViewItem[] | undefined;
	let reconciledKeys: readonly string[] | undefined;
	const ensureReconciled = (): void => {
		if (reconciledItems && reconciledKeys) return;

		reconciledItems = params.itemsReconciler.reconcile(params.getSortedItems());
		reconciledKeys = params.itemsReconciler.getKeys();
	};
	const accessors = createSparseVirtualItemAccessors({
		getLength: params.getLength,
		createItem: (index) => {
			ensureReconciled();
			const item = reconciledItems?.[index];
			const key = reconciledKeys?.[index];
			if (!item || !key) return undefined;
			return params.createItem(item, key, index);
		},
	});
	const resetSparseAccessors = accessors.reset;

	return {
		getItems: accessors.getItems,
		getItem: accessors.getItem,
		reset() {
			reconciledItems = undefined;
			reconciledKeys = undefined;
			resetSparseAccessors();
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
