import { computeVisibleRowRange } from "../layout/flatGridLayout";
import type { FlatLogicalCellSource } from "../flatLogicalCellSource";
import type { VirtualListLogicalCell } from "../logicalCell";
import type { RowRange } from "../rowRange";
import type { FlatGridLayoutMetrics } from "../layoutMetrics";
import type {
	VirtualNavigationTarget,
	VirtualRanges,
	VirtualRow,
	VirtualRowModel,
} from "../types";
import {
	createVirtualListLayoutRevisionToken,
	createVirtualListRevision,
} from "../core/virtualListRevision";
import { resolveFlatVirtualNavigationTarget } from "../navigation/flatVirtualNavigation";

export interface FlatLinkRowModelInput<T> {
	cellSource: FlatLogicalCellSource<T>;
	layout: FlatGridLayoutMetrics;
}

export interface FlatLinkVirtualRow<T> extends VirtualRow<
	VirtualListLogicalCell<T>
> {
	startCellIndex: number;
}

export interface FlatLinkRowModel<T> extends VirtualRowModel<
	VirtualListLogicalCell<T>
> {
	cellSource: FlatLogicalCellSource<T>;
	cellCount: number;
	getCellIndex(rowIndex: number, columnIndex: number): number;
	resolveCellAtIndex(index: number): VirtualListLogicalCell<T> | null;
	findVisibleRanges(params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
}

export function createFlatLinkRowModel<T>(
	input: FlatLinkRowModelInput<T>,
): FlatLinkRowModel<T> {
	const columns = Math.max(1, input.layout.columns);
	const cellSource = input.cellSource;
	const cellCount = cellSource.cellCount;
	const rowCount = cellCount > 0 ? Math.ceil(cellCount / columns) : 0;
	const rowCellCountByRow = new Uint16Array(rowCount);
	const rowStride = input.layout.rowHeight + input.layout.gap;
	const totalHeight =
		rowCount > 0
			? rowCount * input.layout.rowHeight +
				(rowCount - 1) * input.layout.gap
			: 0;

	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
		const startCellIndex = rowIndex * columns;
		rowCellCountByRow[rowIndex] = Math.min(
			columns,
			Math.max(0, cellCount - startCellIndex),
		);
	}

	const getCellIndex = (rowIndex: number, columnIndex: number): number =>
		rowIndex * columns + columnIndex;
	const resolveCellAtIndex = (
		index: number,
	): VirtualListLogicalCell<T> | null => cellSource.resolveCellAtIndex(index);
	const findVisibleRange = (params: {
		scrollTop: number;
		viewportHeight: number;
		overscanPx: number;
	}): RowRange => {
		const overscanRows =
			rowStride > 0
				? Math.ceil(Math.max(0, params.overscanPx) / rowStride)
				: 0;

		return computeVisibleRowRange({
			scrollTop: params.scrollTop,
			viewportHeight: params.viewportHeight,
			sectionTop: 0,
			rowHeight: input.layout.rowHeight,
			gap: input.layout.gap,
			rowCount,
			overscanRows,
		});
	};
	const findVisibleRanges = (params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		const mounted =
			mountedOverscanPx <= 0
				? findVisibleRange({
						scrollTop: params.scrollTop,
						viewportHeight: params.viewportHeight,
						overscanPx: 0,
					})
				: findVisibleRange({
						scrollTop: params.scrollTop,
						viewportHeight: params.viewportHeight,
						overscanPx: mountedOverscanPx,
					});
		const previewVisible =
			previewOverscanPx >= mountedOverscanPx
				? mounted
				: findVisibleRange({
						scrollTop: params.scrollTop,
						viewportHeight: params.viewportHeight,
						overscanPx: previewOverscanPx,
					});

		return {
			mounted,
			previewVisible,
		};
	};
	const layoutRevision = createVirtualListLayoutRevisionToken([
		columns,
		input.layout.cellWidth,
		input.layout.rowHeight,
		input.layout.gap,
	]);

	return {
		revision: createVirtualListRevision({
			content: cellSource.revision,
			layout: layoutRevision,
		}),
		rowCount,
		rowCellCountByRow,
		totalHeight,
		layout: {
			...input.layout,
			contentHeight: totalHeight,
		},
		cellSource,
		cellCount,
		getCellIndex,
		resolveCellAtIndex,
		getRow(rowIndex): FlatLinkVirtualRow<T> | null {
			if (rowIndex < 0 || rowIndex >= rowCount) {
				return null;
			}

			const startCellIndex = rowIndex * columns;
			const rowCellCount = rowCellCountByRow[rowIndex];
			const isLastRow = rowIndex === rowCount - 1;

			return {
				key: rowIndex,
				index: rowIndex,
				top: rowIndex * rowStride,
				height: input.layout.rowHeight,
				bottomSpacing: isLastRow ? 0 : input.layout.gap,
				cellCount: rowCellCount,
				startCellIndex,
				getCell(columnIndex) {
					if (columnIndex < 0 || columnIndex >= rowCellCount) {
						return null;
					}

					return resolveCellAtIndex(startCellIndex + columnIndex);
				},
			};
		},
		findVisibleRange(params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		}): RowRange {
			return findVisibleRange(params);
		},
		findVisibleRanges(params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		}): VirtualRanges {
			return findVisibleRanges(params);
		},
		resolveNavigationTarget(
			currentKey,
			direction,
			currentPosition,
		): VirtualNavigationTarget | null {
			return resolveFlatVirtualNavigationTarget({
				rowModel: this,
				cellCount,
				resolveCellAtIndex,
				currentKey,
				direction,
				currentPosition,
			});
		},
	};
}
