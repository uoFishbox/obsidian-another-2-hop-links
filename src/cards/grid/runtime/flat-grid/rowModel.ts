import type { FlatGridCellSource } from "./cellSource";
import type { FlatGridLogicalCell } from "./logicalCell";
import {
	createSectionedGridGeometry,
	resolveVirtualRangesInto,
	type FlatGridLayoutMetrics,
	type MutableRowRange,
	type MutableVirtualRanges,
	type RowRange,
	type StableScrollTopBand,
	type VirtualNavigationTarget,
	type VirtualSequentialNavigationDirection,
	type VirtualSequentialNavigationTarget,
	type VirtualRow,
	type VirtualRowModel,
} from "cards/virtualization/public";
import { resolveFlatVirtualNavigationTarget } from "./navigation";

export interface FlatGridRowModelInput<T> {
	cellSource: FlatGridCellSource<T>;
	layout: FlatGridLayoutMetrics;
}

type StableScrollTopBandMutable = {
	-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
};

export interface FlatGridRowModel<T> extends VirtualRowModel<FlatGridLogicalCell<T>> {
	cellSource: FlatGridCellSource<T>;
	cellCount: number;
	getCellIndex(rowIndex: number, columnIndex: number): number;
	resolveCellAtIndex(index: number): FlatGridLogicalCell<T> | null;
	/**
	 * Writes the open scrollTop interval covered by the supplied resident rows.
	 */
	findMountedCoverageScrollTopBandInto(
		out: StableScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mounted: RowRange;
			requiredOverscanPx: number;
		},
	): void;
}

export function createFlatGridRowModel<T>(
	input: FlatGridRowModelInput<T>,
): FlatGridRowModel<T> {
	const cellSource = input.cellSource;
	const cellCount = cellSource.cellCount;
	const geometry = createSectionedGridGeometry({
		sectionCellCounts: cellCount > 0 ? [cellCount] : [],
		columns: input.layout.columns,
		rowHeight: input.layout.rowHeight,
		gap: input.layout.gap,
		sectionMarginBottom: 0,
	});
	const columns = geometry.columns;
	const rowCount = geometry.rowCount;
	const rowStride = geometry.rowStride;
	const totalHeight = geometry.totalHeight;

	const getCellIndex = (rowIndex: number, columnIndex: number): number =>
		rowIndex * columns + columnIndex;
	const resolveCellAtIndex = (index: number): FlatGridLogicalCell<T> | null =>
		cellSource.resolveCellAtIndex(index);
	const resolveOverscanRows = (overscanPx: number): number =>
		rowStride > 0 ? Math.ceil(Math.max(0, overscanPx) / rowStride) : 0;
	const writeVisibleRange = (
		out: MutableRowRange,
		scrollTop: number,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		if (rowCount <= 0) {
			out.start = 0;
			out.end = 0;
			return;
		}
		if (rowStride <= 0) {
			out.start = 0;
			out.end = rowCount;
			return;
		}

		const sectionViewportTop = scrollTop;
		const sectionViewportBottom = scrollTop + viewportHeight;
		if (sectionViewportBottom <= 0 || sectionViewportTop >= totalHeight) {
			out.start = 0;
			out.end = 0;
			return;
		}

		const overscanRows = resolveOverscanRows(overscanPx);
		const firstVisibleRow = Math.floor(Math.max(0, sectionViewportTop) / rowStride);
		const lastVisibleRow = Math.floor(
			Math.max(0, sectionViewportBottom - 1) / rowStride,
		);
		out.start = Math.max(0, firstVisibleRow - overscanRows);
		out.end = Math.min(rowCount, lastVisibleRow + overscanRows + 1);
	};
	const findVisibleRangesInto = (
		out: MutableVirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		resolveVirtualRangesInto(out, params, writeVisibleRange);
	};
	const writeInvalidCoverageBand = (out: StableScrollTopBandMutable): void => {
		out.min = Number.POSITIVE_INFINITY;
		out.max = Number.NEGATIVE_INFINITY;
	};
	const findMountedCoverageScrollTopBandInto = (
		out: StableScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mounted: RowRange;
			requiredOverscanPx: number;
		},
	): void => {
		const { mounted, viewportHeight } = params;
		if (mounted.start >= mounted.end || viewportHeight <= 0) {
			writeInvalidCoverageBand(out);
			return;
		}
		if (rowStride <= 0) {
			out.min = Number.NEGATIVE_INFINITY;
			out.max = Number.POSITIVE_INFINITY;
			return;
		}

		const requiredOverscanRows = resolveOverscanRows(params.requiredOverscanPx);
		out.min =
			mounted.start === 0
				? -viewportHeight
				: (mounted.start + requiredOverscanRows) * rowStride;
		out.max =
			mounted.end >= rowCount
				? totalHeight
				: (mounted.end - requiredOverscanRows) * rowStride - viewportHeight + 1;
		if (out.min >= out.max) {
			writeInvalidCoverageBand(out);
		}
	};
	return {
		rowCount,
		totalHeight,
		layout: {
			...input.layout,
			contentHeight: totalHeight,
		},
		cellSource,
		cellCount,
		getCellIndex,
		resolveCellAtIndex,
		getRow(rowIndex): VirtualRow<FlatGridLogicalCell<T>> | null {
			const rowPosition = geometry.resolveRow(rowIndex);
			if (!rowPosition) return null;
			const startCellIndex = rowIndex * columns;
			return {
				top: rowPosition.top,
				cellCount: rowPosition.cellCount,
				getCell(columnIndex) {
					if (columnIndex < 0 || columnIndex >= rowPosition.cellCount) {
						return null;
					}

					return resolveCellAtIndex(startCellIndex + columnIndex);
				},
			};
		},
		findVisibleRangeInto(
			out: MutableRowRange,
			params: {
				scrollTop: number;
				viewportHeight: number;
				overscanPx: number;
			},
		): void {
			writeVisibleRange(
				out,
				params.scrollTop,
				params.viewportHeight,
				params.overscanPx,
			);
		},
		findVisibleRangesInto,
		findMountedCoverageScrollTopBandInto,
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
		resolveSequentialNavigationTarget(
			currentKey: string,
			direction: VirtualSequentialNavigationDirection,
			currentPosition: { rowIndex: number; columnIndex: number },
		): VirtualSequentialNavigationTarget | null {
			const currentIndex = getCellIndex(
				currentPosition.rowIndex,
				currentPosition.columnIndex,
			);
			const currentCell = resolveCellAtIndex(currentIndex);
			if (!currentCell || currentCell.key !== currentKey) return null;

			const targetIndex =
				direction === "forward" ? currentIndex + 1 : currentIndex - 1;
			if (targetIndex < 0 || targetIndex >= cellCount) return null;

			const targetCell = resolveCellAtIndex(targetIndex);
			if (!targetCell) return null;
			const rowIndex = Math.floor(targetIndex / columns);
			const columnIndex = targetIndex % columns;
			const targetRow = this.getRow(rowIndex);
			if (!targetRow) return null;

			return {
				key: targetCell.key,
				rowTop: targetRow.top,
				rowIndex,
				columnIndex,
			};
		},
	};
}
