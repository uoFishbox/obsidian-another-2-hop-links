import type { FlatLogicalCellSource } from "../flatLogicalCellSource";
import type { VirtualListLogicalCell } from "../logicalCell";
import type { RowRange } from "../rowRange";
import type { FlatGridLayoutMetrics } from "../layoutMetrics";
import type { StablePreviewScrollTopBand } from "../core/scrollWindowGate";
import type {
	VirtualNavigationTarget,
	VirtualRanges,
	VirtualRow,
	VirtualRowModel,
} from "../types";
import {
	createMutableVirtualRanges,
	normalizePreviewOverscan,
	resolveVirtualRangesInto,
	resolveVisibleRange,
} from "../virtualRanges";
import type {
	FindVisibleRangeParams,
	ResolveVirtualRangesParams,
} from "../virtualRanges";
import {
	createVirtualListLayoutRevisionToken,
	createVirtualListRevision,
} from "../core/virtualListRevision";
import { resolveFlatVirtualNavigationTarget } from "../navigation/flatVirtualNavigation";

export interface FlatLinkRowModelInput<T> {
	cellSource: FlatLogicalCellSource<T>;
	layout: FlatGridLayoutMetrics;
}

export interface FlatLinkVirtualRow<T> extends VirtualRow<VirtualListLogicalCell<T>> {
	startCellIndex: number;
}

type StablePreviewScrollTopBandMutable = {
	-readonly [K in keyof StablePreviewScrollTopBand]: StablePreviewScrollTopBand[K];
};

export interface FlatLinkRowModel<T> extends VirtualRowModel<
	VirtualListLogicalCell<T>
> {
	cellSource: FlatLogicalCellSource<T>;
	cellCount: number;
	getCellIndex(rowIndex: number, columnIndex: number): number;
	getRowCellCount(rowIndex: number): number;
	resolveCellAtIndex(index: number): VirtualListLogicalCell<T> | null;
	findVisibleRanges(params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangeInto(
		out: RowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRangesInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findVisibleRangesFromMounted(params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangesFromMountedInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findStablePreviewScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void;
	findStableMountedScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void;
}

export function createFlatLinkRowModel<T>(
	input: FlatLinkRowModelInput<T>,
): FlatLinkRowModel<T> {
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
	const resolveCellAtIndex = (index: number): VirtualListLogicalCell<T> | null =>
		cellSource.resolveCellAtIndex(index);
	const resolveOverscanRows = (overscanPx: number): number =>
		rowStride > 0 ? Math.ceil(Math.max(0, overscanPx) / rowStride) : 0;
	const writeVisibleRange = (
		out: RowRange,
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
	const findVisibleRange = (params: FindVisibleRangeParams): RowRange => {
		return resolveVisibleRange(writeVisibleRange, params);
	};
	const resolveMountedAndPreviewRangesInto = (
		out: VirtualRanges,
		params: ResolveVirtualRangesParams,
	): VirtualRanges => {
		return resolveVirtualRangesInto(out, params, writeVisibleRange);
	};
	const findVisibleRanges = (params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const ranges = createMutableVirtualRanges();
		return resolveMountedAndPreviewRangesInto(ranges, {
			...params,
			reuseMountedReference: true,
		});
	};
	const findVisibleRangesInto = (
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		resolveMountedAndPreviewRangesInto(out, params);
	};
	const findVisibleRangesFromMounted = (params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const ranges = createMutableVirtualRanges();
		return resolveMountedAndPreviewRangesInto(ranges, {
			...params,
			reuseMountedReference: true,
		});
	};
	const findVisibleRangesFromMountedInto = (
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		resolveMountedAndPreviewRangesInto(out, params);
	};
	const writeInvalidStableScrollTopBand = (
		out: StablePreviewScrollTopBandMutable,
	): void => {
		out.min = Number.POSITIVE_INFINITY;
		out.max = Number.NEGATIVE_INFINITY;
	};
	const writeStableScrollTopBand = (
		out: StablePreviewScrollTopBandMutable,
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
	const findStablePreviewScrollTopBandInto = (
		out: StablePreviewScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = normalizePreviewOverscan(
			params.previewOverscanPx,
			mountedOverscanPx,
		);
		if (previewOverscanPx >= mountedOverscanPx) {
			out.min = Number.NEGATIVE_INFINITY;
			out.max = Number.POSITIVE_INFINITY;
			return;
		}
		writeStableScrollTopBand(
			out,
			params.previewVisible,
			params.viewportHeight,
			previewOverscanPx,
		);
	};
	const findStableMountedScrollTopBandInto = (
		out: StablePreviewScrollTopBandMutable,
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
		totalHeight,
		layout: {
			...input.layout,
			contentHeight: totalHeight,
		},
		cellSource,
		cellCount,
		getCellIndex,
		getRowCellCount,
		resolveCellAtIndex,
		getRow(rowIndex): FlatLinkVirtualRow<T> | null {
			if (rowIndex < 0 || rowIndex >= rowCount) {
				return null;
			}

			const startCellIndex = rowIndex * columns;
			const rowCellCount = getRowCellCount(rowIndex);
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
		findVisibleRangeInto(
			out: RowRange,
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
		findVisibleRanges(params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		}): VirtualRanges {
			return findVisibleRanges(params);
		},
		findVisibleRangesInto,
		findVisibleRangesFromMounted,
		findVisibleRangesFromMountedInto,
		findStablePreviewScrollTopBandInto,
		findStableMountedScrollTopBandInto,
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
