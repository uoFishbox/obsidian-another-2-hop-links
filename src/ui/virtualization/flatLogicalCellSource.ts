import {
	logicalCellKey,
	sourceKey,
	type LogicalCellKey,
	type SourceKey,
	type VirtualGridDataSource,
} from "./types";
import type { VirtualListLogicalCell } from "./logicalCell";
import type { RenderRevision } from "./renderRevision";
import { validateFlatLogicalCellSourceInput } from "./validation/flatVirtualListInputValidation";
import {
	formatVirtualListInputError,
	type Result,
	type VirtualListInputError,
} from "./validation/virtualListValidationError";

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

export function createArrayVirtualGridDataSource<T>(params: {
	items: readonly T[];
	getKey: (item: T, index: number) => string;
	revision?: unknown;
	keyRevision?: unknown;
	getItemRenderRevision?: (item: T, index: number) => RenderRevision | undefined;
}): VirtualGridDataSource<T> {
	return {
		count: params.items.length,
		revision: params.revision ?? params.items,
		keyRevision: params.keyRevision ?? params.getKey,
		getItem(index) {
			return params.items[index];
		},
		getKey: params.getKey,
		getItemRenderRevision: params.getItemRenderRevision,
	};
}

export function createFlatLogicalCellSource<T>(params: {
	header: boolean;
	items?: readonly T[];
	dataSource?: VirtualGridDataSource<T>;
	visibleCount: number;
	showLoadMore: boolean;
	getKey?: (item: T, index: number) => string;
	sectionId?: string;
	revision?: unknown;
}): FlatLogicalCellSource<T> {
	const result = tryCreateFlatLogicalCellSource(params);
	if (!result.ok) {
		throw new Error(formatVirtualListInputError(result.error));
	}

	return result.value;
}

export function tryCreateFlatLogicalCellSource<T>(params: {
	header: boolean;
	items?: readonly T[];
	dataSource?: VirtualGridDataSource<T>;
	visibleCount: number;
	showLoadMore: boolean;
	getKey?: (item: T, index: number) => string;
	sectionId?: string;
	revision?: unknown;
}): Result<FlatLogicalCellSource<T>, VirtualListInputError> {
	const validation = validateFlatLogicalCellSourceInput(params);
	if (!validation.ok) {
		return validation;
	}

	const dataSource =
		validation.value.type === "data-source-backed"
			? validation.value.dataSource
			: createArrayVirtualGridDataSource({
					items: validation.value.items,
					getKey: validation.value.getKey,
				});
	const keyPrefix = params.sectionId ?? "link-list";
	const hasHeader = params.header;
	const visibleCount = Math.max(
		0,
		Math.min(dataSource.count, Math.floor(params.visibleCount)),
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
		data: dataSource.revision,
		key: dataSource.keyRevision,
		visibleCount,
		hasHeader,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	};

	return {
		ok: true,
		value: {
			revision,
			cellCount,
			hasHeader,
			visibleCount,
			showLoadMore: params.showLoadMore,
			resolveLogicalCellKeyAtItemIndex(itemIndex) {
				if (itemIndex < 0 || itemIndex >= visibleCount) {
					return null;
				}

				const item = dataSource.getItem(itemIndex);
				if (item === undefined) {
					return null;
				}

				return logicalCellKey(
					`${dataSource.getKey(item, itemIndex)}::item:${itemIndex}`,
				);
			},
			resolveSourceKeyAtItemIndex(itemIndex) {
				if (itemIndex < 0 || itemIndex >= visibleCount) {
					return null;
				}

				const item = dataSource.getItem(itemIndex);
				if (item === undefined) {
					return null;
				}

				return sourceKey(dataSource.getKey(item, itemIndex));
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

				const item = dataSource.getItem(itemIndex);
				if (item === undefined) {
					return null;
				}

				const rawKey = dataSource.getKey(item, itemIndex);
				const key = logicalCellKey(`${rawKey}::item:${itemIndex}`);

				return {
					kind: "item",
					key,
					sourceKey: sourceKey(rawKey),
					item,
					itemIndex,
					itemRenderRevision: dataSource.getItemRenderRevision?.(
						item,
						itemIndex,
					),
				};
			},
		},
	};
}
