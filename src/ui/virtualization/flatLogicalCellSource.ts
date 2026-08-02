import {
	logicalCellKey,
	sourceKey,
	type LogicalCellKey,
	type SourceKey,
} from "./types";
import type { VirtualListLogicalCell } from "./logicalCell";
import type { RenderRevision } from "./renderRevision";

export interface FlatLogicalCellSource<T> {
	readonly revision: unknown;
	readonly cellCount: number;
	readonly hasHeader: boolean;
	readonly visibleCount: number;
	readonly showLoadMore: boolean;
	resolveCellAtIndex(index: number): VirtualListLogicalCell<T> | null;
	resolveLogicalCellKeyAtItemIndex(itemIndex: number): LogicalCellKey | null;
	resolveSourceKeyAtItemIndex(itemIndex: number): SourceKey | null;
}

export function createFlatLogicalCellSource<T>(params: {
	header: boolean;
	items: readonly T[];
	visibleCount: number;
	showLoadMore: boolean;
	getKey: (item: T, index: number) => string;
	getItemRenderRevision?: (item: T, index: number) => RenderRevision | undefined;
	sectionId?: string;
	revision?: unknown;
}): FlatLogicalCellSource<T> {
	const keyPrefix = params.sectionId ?? "link-list";
	const hasHeader = params.header;
	const visibleCount = Math.max(
		0,
		Math.min(params.items.length, Math.floor(params.visibleCount)),
	);
	const headerOffset = hasHeader ? 1 : 0;
	const loadMoreIndex = headerOffset + visibleCount;
	const cellCount = loadMoreIndex + (params.showLoadMore ? 1 : 0);
	const headerCell: VirtualListLogicalCell<T> | null = hasHeader
		? {
				kind: "header",
				key: logicalCellKey(`${keyPrefix}::__header`),
			}
		: null;
	const loadMoreCell: VirtualListLogicalCell<T> | null = params.showLoadMore
		? {
				kind: "load-more",
				key: logicalCellKey(`${keyPrefix}::__load-more`),
			}
		: null;
	const revision = params.revision ?? {
		data: params.items,
		key: params.getKey,
		itemRenderRevisionResolver: params.getItemRenderRevision,
		visibleCount,
		hasHeader,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	};

	return {
		revision,
		cellCount,
		hasHeader,
		visibleCount,
		showLoadMore: params.showLoadMore,
		resolveLogicalCellKeyAtItemIndex(itemIndex) {
			if (itemIndex < 0 || itemIndex >= visibleCount) {
				return null;
			}

			const item = params.items[itemIndex];
			if (item === undefined) {
				return null;
			}

			return logicalCellKey(
				`${params.getKey(item, itemIndex)}::item:${itemIndex}`,
			);
		},
		resolveSourceKeyAtItemIndex(itemIndex) {
			if (itemIndex < 0 || itemIndex >= visibleCount) {
				return null;
			}

			const item = params.items[itemIndex];
			if (item === undefined) {
				return null;
			}

			return sourceKey(params.getKey(item, itemIndex));
		},
		resolveCellAtIndex(index) {
			if (index < 0 || index >= cellCount) {
				return null;
			}

			if (hasHeader && index === 0) {
				return headerCell;
			}
			if (params.showLoadMore && index === loadMoreIndex) {
				return loadMoreCell;
			}

			const itemIndex = index - headerOffset;
			if (itemIndex < 0 || itemIndex >= visibleCount) {
				return null;
			}

			const item = params.items[itemIndex];
			if (item === undefined) {
				return null;
			}

			const rawKey = params.getKey(item, itemIndex);
			const key = logicalCellKey(`${rawKey}::item:${itemIndex}`);

			return {
				kind: "item",
				key,
				sourceKey: sourceKey(rawKey),
				item,
				itemIndex,
				itemRenderRevision: params.getItemRenderRevision?.(item, itemIndex),
			};
		},
	};
}
