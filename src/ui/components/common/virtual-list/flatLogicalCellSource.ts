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

export interface LogicalCellItemKeyResolver<T> {
	resolveLogicalCellKeyAtItemIndex: (
		itemIndex: number,
	) => LogicalCellKey | null;
	resolveSourceKeyAtItemIndex: (itemIndex: number) => SourceKey | null;
}

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
	getItemRenderRevision?: (
		item: T,
		index: number,
	) => RenderRevision | undefined;
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
}): Result<FlatLogicalCellSource<T>, VirtualListInputError<T, unknown>> {
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
	const revision =
		params.revision ?? {
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

export function createArrayBackedFlatLogicalCellSource<T>(
	cells: readonly VirtualListLogicalCell<T>[],
): FlatLogicalCellSource<T> {
	let visibleCount = 0;
	let cellsByItemIndex: Map<number, Extract<
		VirtualListLogicalCell<T>,
		{ kind: "item" }
	>> | null = null;

	for (const cell of cells) {
		if (cell.kind === "item") {
			visibleCount += 1;
		}
	}

	const resolveCellsByItemIndex = () => {
		if (cellsByItemIndex) {
			return cellsByItemIndex;
		}

		const nextCellsByItemIndex = new Map<
			number,
			Extract<VirtualListLogicalCell<T>, { kind: "item" }>
		>();
		for (const cell of cells) {
			if (cell.kind === "item") {
				nextCellsByItemIndex.set(cell.itemIndex, cell);
			}
		}
		cellsByItemIndex = nextCellsByItemIndex;
		return nextCellsByItemIndex;
	};

	return {
		revision: cells,
		cellCount: cells.length,
		hasHeader: cells[0]?.kind === "header",
		visibleCount,
		showLoadMore: cells[cells.length - 1]?.kind === "load-more",
		resolveLogicalCellKeyAtItemIndex(itemIndex) {
			if (itemIndex < 0) {
				return null;
			}

			const cell = resolveCellsByItemIndex().get(itemIndex);
			return cell?.key ?? null;
		},
		resolveSourceKeyAtItemIndex(itemIndex) {
			if (itemIndex < 0) {
				return null;
			}

			const cell = resolveCellsByItemIndex().get(itemIndex);
			return cell?.sourceKey ?? null;
		},
		resolveCellAtIndex(index) {
			if (index < 0 || index >= cells.length) {
				return null;
			}

			return cells[index] ?? null;
		},
	};
}

export function createLogicalCellItemKeyResolver<T>(params:
	| {
			items: readonly T[];
			getKey: (item: T, index: number) => string;
	  }
	| {
			dataSource: VirtualGridDataSource<T>;
	  },
): LogicalCellItemKeyResolver<T> {
	const dataSource =
		"dataSource" in params
			? params.dataSource
			: createArrayVirtualGridDataSource({
					items: params.items,
					getKey: params.getKey,
				});
	return {
		resolveSourceKeyAtItemIndex(itemIndex) {
			if (itemIndex < 0 || itemIndex >= dataSource.count) {
				return null;
			}

			const item = dataSource.getItem(itemIndex);
			if (item === undefined) {
				return null;
			}

			return sourceKey(dataSource.getKey(item, itemIndex));
		},
		resolveLogicalCellKeyAtItemIndex(itemIndex) {
			const key = this.resolveSourceKeyAtItemIndex(itemIndex);
			if (!key) {
				return null;
			}

			return logicalCellKey(`${key}::item:${itemIndex}`);
		},
	};
}
