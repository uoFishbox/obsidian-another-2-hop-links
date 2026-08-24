import type { FlatGridCellSource } from "./cellSource";
import type { FlatGridLogicalCell } from "./logicalCell";
import {
	resolveVirtualRangesInto,
	type FlatGridLayoutMetrics,
	type MutableRowRange,
	type MutableVirtualRanges,
	type RowRange,
	type StableScrollTopBand,
	type VirtualNavigationTarget,
	type VirtualRow,
	type VirtualRowModel,
} from "ui/virtualization/public";
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
	findStableMountedScrollTopBandInto(
		out: StableScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void;
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
	const columns = Math.max(1, input.layout.columns);
	const cellSource = input.cellSource;
	const cellCount = cellSource.cellCount;
	const rowCount = cellCount > 0 ? Math.ceil(cellCount / columns) : 0;
	const rowStride = input.layout.rowHeight + input.layout.gap;
	const totalHeight =
		rowCount > 0
			? rowCount * input.layout.rowHeight + (rowCount - 1) * input.layout.gap
			: 0;

	const getRowCellCount = (rowIndex: number): number => {
		if (rowIndex < 0 || rowIndex >= rowCount) {
			return 0;
		}
		const startCellIndex = rowIndex * columns;
		return Math.min(columns, Math.max(0, cellCount - startCellIndex));
	};

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
			mounted?: RowRange;
		},
	): void => {
		resolveVirtualRangesInto(out, params, writeVisibleRange);
	};
	const writeInvalidStableScrollTopBand = (out: StableScrollTopBandMutable): void => {
		out.min = Number.POSITIVE_INFINITY;
		out.max = Number.NEGATIVE_INFINITY;
	};
	const writeStableScrollTopBand = (
		out: StableScrollTopBandMutable,
		range: RowRange,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		if (range.start >= range.end || viewportHeight <= 0) {
			writeInvalidStableScrollTopBand(out);
			return;
		}
		if (rowStride <= 0) {
			out.min = Number.NEGATIVE_INFINITY;
			out.max = Number.POSITIVE_INFINITY;
			return;
		}

		const overscanRows = resolveOverscanRows(overscanPx);
		const minForStart =
			range.start === 0
				? Number.NEGATIVE_INFINITY
				: (range.start + overscanRows) * rowStride;
		const maxForStart = (range.start + overscanRows + 1) * rowStride;
		const endBoundaryRow = range.end - overscanRows - 1;
		const minForEnd = endBoundaryRow * rowStride - viewportHeight + 1;
		const maxForEnd =
			range.end >= rowCount
				? Number.POSITIVE_INFINITY
				: (endBoundaryRow + 1) * rowStride - viewportHeight + 1;

		out.min = Math.max(minForStart, minForEnd, -viewportHeight);
		out.max = Math.min(maxForStart, maxForEnd, totalHeight);
		if (out.min >= out.max) {
			writeInvalidStableScrollTopBand(out);
		}
	};
	const findStableMountedScrollTopBandInto = (
		out: StableScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void => {
		writeStableScrollTopBand(
			out,
			params.mounted,
			params.viewportHeight,
			Math.max(0, params.mountedOverscanPx),
		);
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
			writeInvalidStableScrollTopBand(out);
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
			writeInvalidStableScrollTopBand(out);
		}
	};
	return {
		revision: {
			content: cellSource.revision,
			layout: Object.freeze([
				columns,
				input.layout.cellWidth,
				input.layout.rowHeight,
				input.layout.gap,
			]),
		},
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
			if (rowIndex < 0 || rowIndex >= rowCount) {
				return null;
			}

			const startCellIndex = rowIndex * columns;
			const rowCellCount = getRowCellCount(rowIndex);
			return {
				top: rowIndex * rowStride,
				cellCount: rowCellCount,
				getCell(columnIndex) {
					if (columnIndex < 0 || columnIndex >= rowCellCount) {
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
		findStableMountedScrollTopBandInto,
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
	};
}
