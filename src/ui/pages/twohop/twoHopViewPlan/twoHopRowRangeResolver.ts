import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { SectionedGridResolvedRowScratch } from "ui/components/common/virtual-list/row-models/sectionedGridMountedRows";
import type {
	FindTwoHopRowsByOffsetParams,
	FirstTwoHopRowByTopResolutionScratch,
	ResolveTwoHopRowTopsForBandParams,
	StablePreviewScrollTopBandMutable,
	TwoHopBandRowTopsMutable,
	TwoHopResolvedRow,
	TwoHopSectionPlan,
	TwoHopSectionTable,
	TwoHopViewPlan,
} from "./types";
export function findTwoHopSectionIndexByRow(
	sectionTable: TwoHopSectionTable,
	rowIndex: number,
): number {
	if (rowIndex < 0 || sectionTable.sectionCount === 0) return -1;
	let low = 0;
	let high = sectionTable.sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sectionTable.firstRowIndexBySection[mid] > rowIndex) high = mid;
		else low = mid + 1;
	}
	const sectionIndex = low - 1;
	if (
		sectionIndex < 0 ||
		rowIndex >=
			sectionTable.firstRowIndexBySection[sectionIndex] +
				sectionTable.rowCountBySection[sectionIndex]
	) {
		return -1;
	}
	return sectionIndex;
}

export function resolveTwoHopRowInSection(
	plan: TwoHopViewPlan,
	sectionPlan: TwoHopSectionPlan,
	rowIndex: number,
): TwoHopResolvedRow | null {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	const sectionIndex = table.sectionIndexByRow[rowIndex];
	if (sectionIndex !== sectionPlan.sectionIndex) return null;
	const rowIndexInSection = table.rowIndexInSectionByRow[rowIndex];
	const sectionCellStartIndex = table.sectionCellStartByRow[rowIndex];
	return {
		sectionIndex,
		rowIndexInSection,
		firstCellIndex: sectionPlan.firstCellIndex + sectionCellStartIndex,
		sectionCellStartIndex,
		cellCount: table.cellCountByRow[rowIndex],
		top: table.topByRow[rowIndex],
	};
}

/**
 * Into-style variant of {@link resolveTwoHopRowInSection} that writes into a
 * reusable scratch object instead of allocating a new object per call.
 * Only writes the 4 fields required by {@link SectionedGridResolvedRow}.
 */
export function resolveTwoHopRowInSectionInto(
	out: SectionedGridResolvedRowScratch,
	plan: TwoHopViewPlan,
	sectionPlan: TwoHopSectionPlan,
	rowIndex: number,
): boolean {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return false;
	if (table.sectionIndexByRow[rowIndex] !== sectionPlan.sectionIndex) return false;
	out.rowIndexInSection = table.rowIndexInSectionByRow[rowIndex];
	out.sectionCellStartIndex = table.sectionCellStartByRow[rowIndex];
	out.cellCount = table.cellCountByRow[rowIndex];
	out.top = table.topByRow[rowIndex];
	return true;
}

export function resolveTwoHopRow(
	plan: TwoHopViewPlan,
	rowIndex: number,
): TwoHopResolvedRow | null {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	const sectionIndex = table.sectionIndexByRow[rowIndex];
	const sectionPlan = plan.sections[sectionIndex];
	const rowIndexInSection = table.rowIndexInSectionByRow[rowIndex];
	const sectionCellStartIndex = table.sectionCellStartByRow[rowIndex];
	return {
		sectionIndex,
		rowIndexInSection,
		firstCellIndex: sectionPlan.firstCellIndex + sectionCellStartIndex,
		sectionCellStartIndex,
		cellCount: table.cellCountByRow[rowIndex],
		top: table.topByRow[rowIndex],
	};
}

/**
 * Reads the top offset for a row, or null when the row index is out of range.
 * Returns a scalar to avoid allocating a tiny object.
 */
function readTwoHopRowTop(plan: TwoHopViewPlan, rowIndex: number): number | null {
	const table = plan.rowTable;
	if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
	return table.topByRow[rowIndex];
}

export function resolveTwoHopRowTopsForBandInto(
	out: TwoHopBandRowTopsMutable,
	plan: TwoHopViewPlan,
	params: ResolveTwoHopRowTopsForBandParams,
): void {
	out.previousStartRowTop = null;
	out.currentStartRowTop = null;
	out.previousEndRowTop = null;
	out.currentEndRowTop = null;
	if (params.startRow >= params.endRow) return;

	const currentStartTop = readTwoHopRowTop(plan, params.startRow);
	if (currentStartTop === null) return;

	const previousStartTop = readTwoHopRowTop(plan, params.startRow - 1);
	const previousEndTop = readTwoHopRowTop(plan, params.endRow - 1);
	const currentEndTop =
		previousEndTop !== null ? readTwoHopRowTop(plan, params.endRow) : null;

	out.previousStartRowTop = previousStartTop;
	out.currentStartRowTop = currentStartTop;
	out.previousEndRowTop = previousEndTop;
	out.currentEndRowTop = currentEndTop;
}

function upperBoundSectionTop(
	sectionTable: TwoHopSectionTable,
	target: number,
): number {
	let low = 0;
	let high = sectionTable.sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sectionTable.topBySection[mid] > target) high = mid;
		else low = mid + 1;
	}
	return low;
}

function lowerBoundSectionTop(
	sectionTable: TwoHopSectionTable,
	target: number,
): number {
	let low = 0;
	let high = sectionTable.sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sectionTable.topBySection[mid] >= target) high = mid;
		else low = mid + 1;
	}
	return low;
}

function readTwoHopSectionTableRowCount(
	sectionTable: TwoHopSectionTable,
): number {
	if (sectionTable.sectionCount === 0) return 0;
	const lastSectionIndex = sectionTable.sectionCount - 1;
	return (
		sectionTable.firstRowIndexBySection[lastSectionIndex] +
		sectionTable.rowCountBySection[lastSectionIndex]
	);
}

function writeFirstTwoHopRowByTopFromSection(
	out: FirstTwoHopRowByTopResolutionScratch,
	sectionTable: TwoHopSectionTable,
	rowStride: number,
	target: number,
	inclusive: boolean,
	sectionIndex: number,
	rowCount: number,
): void {
	if (sectionIndex < 0 || sectionIndex >= sectionTable.sectionCount) {
		out.rowIndex = rowCount;
		out.sectionIndex = sectionTable.sectionCount;
		return;
	}
	const sectionTop = sectionTable.topBySection[sectionIndex];
	const sectionRowCount = sectionTable.rowCountBySection[sectionIndex];
	const relativeTarget = target - sectionTop;
	const rowIndexInSection = inclusive
		? Math.ceil(relativeTarget / rowStride)
		: Math.floor(relativeTarget / rowStride) + 1;
	const firstMatchingRowIndex = Math.max(0, rowIndexInSection);
	if (firstMatchingRowIndex < sectionRowCount) {
		out.rowIndex =
			sectionTable.firstRowIndexBySection[sectionIndex] + firstMatchingRowIndex;
		out.sectionIndex = sectionIndex;
		return;
	}
	const nextSectionIndex = sectionIndex + 1;
	if (nextSectionIndex < sectionTable.sectionCount) {
		out.rowIndex = sectionTable.firstRowIndexBySection[nextSectionIndex];
		out.sectionIndex = nextSectionIndex;
	} else {
		out.rowIndex = rowCount;
		out.sectionIndex = sectionTable.sectionCount;
	}
}

function canResolveFirstTwoHopRowByTopFromSection(
	sectionTable: TwoHopSectionTable,
	target: number,
	inclusive: boolean,
	sectionIndex: number,
): boolean {
	const nextSectionIndex = sectionIndex + 1;
	if (nextSectionIndex >= sectionTable.sectionCount) return true;
	const nextSectionTop = sectionTable.topBySection[nextSectionIndex];
	return target < nextSectionTop || (inclusive && target === nextSectionTop);
}

function writeFirstTwoHopRowByTop(
	out: FirstTwoHopRowByTopResolutionScratch,
	sectionTable: TwoHopSectionTable,
	rowStride: number,
	target: number,
	inclusive: boolean,
): void {
	if (sectionTable.sectionCount === 0) {
		out.rowIndex = 0;
		out.sectionIndex = 0;
		return;
	}
	const rowCount = readTwoHopSectionTableRowCount(sectionTable);
	const boundaryIndex = inclusive
		? lowerBoundSectionTop(sectionTable, target)
		: upperBoundSectionTop(sectionTable, target);
	if (inclusive) {
		if (
			boundaryIndex < sectionTable.sectionCount &&
			sectionTable.topBySection[boundaryIndex] === target
		) {
			out.rowIndex = sectionTable.firstRowIndexBySection[boundaryIndex];
			out.sectionIndex = boundaryIndex;
			return;
		}
	}
	if (rowStride <= 0) {
		if (boundaryIndex < sectionTable.sectionCount) {
			out.rowIndex = sectionTable.firstRowIndexBySection[boundaryIndex];
			out.sectionIndex = boundaryIndex;
		} else {
			out.rowIndex = rowCount;
			out.sectionIndex = sectionTable.sectionCount;
		}
		return;
	}
	const sectionIndex = Math.max(0, boundaryIndex - 1);
	writeFirstTwoHopRowByTopFromSection(
		out,
		sectionTable,
		rowStride,
		target,
		inclusive,
		sectionIndex,
		rowCount,
	);
}

export function writeTwoHopRowsByOffsetIntoScratch(
	out: RowRange,
	resolutionScratch: FirstTwoHopRowByTopResolutionScratch,
	sectionTable: TwoHopSectionTable,
	rowHeight: number,
	rowGap: number,
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
): void {
	if (sectionTable.sectionCount === 0 || viewportHeight <= 0) {
		out.start = 0;
		out.end = 0;
		return;
	}
	const normalizedOverscanPx = Math.max(0, overscanPx);
	const startOffset = scrollTop - normalizedOverscanPx;
	const endOffset = scrollTop + viewportHeight + normalizedOverscanPx;
	const rowStride = rowHeight + rowGap;
	const startTarget = startOffset - rowHeight;
	const endTarget = endOffset;
	writeFirstTwoHopRowByTop(
		resolutionScratch,
		sectionTable,
		rowStride,
		startTarget,
		false,
	);
	const rowCount = readTwoHopSectionTableRowCount(sectionTable);
	const start = resolutionScratch.rowIndex;
	const startSectionIndex = resolutionScratch.sectionIndex;
	let endRow: number;
	if (
		rowStride > 0 &&
		canResolveFirstTwoHopRowByTopFromSection(
			sectionTable,
			endTarget,
			true,
			startSectionIndex,
		)
	) {
		writeFirstTwoHopRowByTopFromSection(
			resolutionScratch,
			sectionTable,
			rowStride,
			endTarget,
			true,
			startSectionIndex,
			rowCount,
		);
		endRow = resolutionScratch.rowIndex;
	} else {
		writeFirstTwoHopRowByTop(
			resolutionScratch,
			sectionTable,
			rowStride,
			endTarget,
			true,
		);
		endRow = resolutionScratch.rowIndex;
	}
	out.start = start < endRow ? start : 0;
	out.end = start < endRow ? endRow : 0;
}

function writeTwoHopRowsByOffset(
	out: RowRange,
	sectionTable: TwoHopSectionTable,
	rowHeight: number,
	rowGap: number,
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
): void {
	const resolutionScratch: FirstTwoHopRowByTopResolutionScratch = {
		rowIndex: 0,
		sectionIndex: 0,
	};
	writeTwoHopRowsByOffsetIntoScratch(
		out,
		resolutionScratch,
		sectionTable,
		rowHeight,
		rowGap,
		scrollTop,
		viewportHeight,
		overscanPx,
	);
}

export function findTwoHopRowsByOffsetInto(
	out: RowRange,
	params: FindTwoHopRowsByOffsetParams,
): void {
	writeTwoHopRowsByOffset(
		out,
		params.sectionTable,
		params.rowHeight,
		params.rowGap,
		params.scrollTop,
		params.viewportHeight,
		params.overscanPx,
	);
}

export function findTwoHopRowsByOffset(params: FindTwoHopRowsByOffsetParams): RowRange {
	const range = { start: 0, end: 0 };
	findTwoHopRowsByOffsetInto(range, params);
	return range;
}

type WriteStablePreviewScrollTopBandParams = {
	readonly previewVisible: RowRange;
	readonly viewportHeight: number;
	readonly overscanPx: number;
};

function writeInvalidStablePreviewScrollTopBand(
	out: StablePreviewScrollTopBandMutable,
): void {
	out.min = Number.POSITIVE_INFINITY;
	out.max = Number.NEGATIVE_INFINITY;
}

export function writeTwoHopStablePreviewScrollTopBand(
	out: StablePreviewScrollTopBandMutable,
	rowTops: TwoHopBandRowTopsMutable,
	plan: TwoHopViewPlan,
	params: WriteStablePreviewScrollTopBandParams,
): void {
	const range = params.previewVisible;
	if (range.start >= range.end || params.viewportHeight <= 0) {
		writeInvalidStablePreviewScrollTopBand(out);
		return;
	}

	resolveTwoHopRowTopsForBandInto(rowTops, plan, {
		startRow: range.start,
		endRow: range.end,
	});
	if (rowTops.currentStartRowTop === null || rowTops.previousEndRowTop === null) {
		writeInvalidStablePreviewScrollTopBand(out);
		return;
	}

	const normalizedOverscanPx = Math.max(0, params.overscanPx);
	const minForStart =
		rowTops.previousStartRowTop === null
			? Number.NEGATIVE_INFINITY
			: rowTops.previousStartRowTop + plan.rowHeight + normalizedOverscanPx;
	const maxForStart =
		rowTops.currentStartRowTop + plan.rowHeight + normalizedOverscanPx;
	const minForEnd =
		rowTops.previousEndRowTop - params.viewportHeight - normalizedOverscanPx;
	const maxForEnd =
		rowTops.currentEndRowTop === null
			? Number.POSITIVE_INFINITY
			: rowTops.currentEndRowTop - params.viewportHeight - normalizedOverscanPx;

	out.min = Math.max(minForStart, minForEnd);
	out.max = Math.min(maxForStart, maxForEnd);
	if (out.min >= out.max) {
		writeInvalidStablePreviewScrollTopBand(out);
	}
}
