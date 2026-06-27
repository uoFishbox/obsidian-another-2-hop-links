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
	TwoHopViewPlan,
} from "./types";
export function findTwoHopSectionIndexByRow(
	sections: readonly TwoHopSectionPlan[],
	rowIndex: number,
): number {
	if (rowIndex < 0 || sections.length === 0) return -1;
	let low = 0;
	let high = sections.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sections[mid].firstRowIndex > rowIndex) high = mid;
		else low = mid + 1;
	}
	const sectionIndex = low - 1;
	const section = sections[sectionIndex];
	if (!section || rowIndex >= section.firstRowIndex + section.rowCount) {
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
	sections: readonly TwoHopSectionPlan[],
	target: number,
): number {
	let low = 0;
	let high = sections.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sections[mid].top > target) high = mid;
		else low = mid + 1;
	}
	return low;
}

function lowerBoundSectionTop(
	sections: readonly TwoHopSectionPlan[],
	target: number,
): number {
	let low = 0;
	let high = sections.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (sections[mid].top >= target) high = mid;
		else low = mid + 1;
	}
	return low;
}

function writeFirstTwoHopRowByTopFromSection(
	out: FirstTwoHopRowByTopResolutionScratch,
	sections: readonly TwoHopSectionPlan[],
	rowStride: number,
	target: number,
	inclusive: boolean,
	sectionIndex: number,
	rowCount: number,
): void {
	const section = sections[sectionIndex];
	if (!section) {
		out.rowIndex = rowCount;
		out.sectionIndex = sections.length;
		return;
	}
	const relativeTarget = target - section.top;
	const rowIndexInSection = inclusive
		? Math.ceil(relativeTarget / rowStride)
		: Math.floor(relativeTarget / rowStride) + 1;
	const firstMatchingRowIndex = Math.max(0, rowIndexInSection);
	if (firstMatchingRowIndex < section.rowCount) {
		out.rowIndex = section.firstRowIndex + firstMatchingRowIndex;
		out.sectionIndex = sectionIndex;
		return;
	}
	const nextSectionIndex = sectionIndex + 1;
	const nextSection = sections[nextSectionIndex];
	if (nextSection) {
		out.rowIndex = nextSection.firstRowIndex;
		out.sectionIndex = nextSectionIndex;
	} else {
		out.rowIndex = rowCount;
		out.sectionIndex = sections.length;
	}
}

function canResolveFirstTwoHopRowByTopFromSection(
	sections: readonly TwoHopSectionPlan[],
	target: number,
	inclusive: boolean,
	sectionIndex: number,
): boolean {
	const nextSection = sections[sectionIndex + 1];
	if (!nextSection) return true;
	return target < nextSection.top || (inclusive && target === nextSection.top);
}

function writeFirstTwoHopRowByTop(
	out: FirstTwoHopRowByTopResolutionScratch,
	sections: readonly TwoHopSectionPlan[],
	rowStride: number,
	target: number,
	inclusive: boolean,
): void {
	if (sections.length === 0) {
		out.rowIndex = 0;
		out.sectionIndex = 0;
		return;
	}
	const lastSection = sections[sections.length - 1];
	const rowCount = lastSection.firstRowIndex + lastSection.rowCount;
	const boundaryIndex = inclusive
		? lowerBoundSectionTop(sections, target)
		: upperBoundSectionTop(sections, target);
	if (inclusive) {
		const matchingSection = sections[boundaryIndex];
		if (matchingSection?.top === target) {
			out.rowIndex = matchingSection.firstRowIndex;
			out.sectionIndex = boundaryIndex;
			return;
		}
	}
	if (rowStride <= 0) {
		const matchingSection = sections[boundaryIndex];
		if (matchingSection) {
			out.rowIndex = matchingSection.firstRowIndex;
			out.sectionIndex = boundaryIndex;
		} else {
			out.rowIndex = rowCount;
			out.sectionIndex = sections.length;
		}
		return;
	}
	const sectionIndex = Math.max(0, boundaryIndex - 1);
	writeFirstTwoHopRowByTopFromSection(
		out,
		sections,
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
	sections: readonly TwoHopSectionPlan[],
	rowHeight: number,
	rowGap: number,
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
): void {
	if (sections.length === 0 || viewportHeight <= 0) {
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
		sections,
		rowStride,
		startTarget,
		false,
	);
	const lastSection = sections[sections.length - 1];
	const rowCount = lastSection.firstRowIndex + lastSection.rowCount;
	const start = resolutionScratch.rowIndex;
	const startSectionIndex = resolutionScratch.sectionIndex;
	let endRow: number;
	if (
		rowStride > 0 &&
		canResolveFirstTwoHopRowByTopFromSection(
			sections,
			endTarget,
			true,
			startSectionIndex,
		)
	) {
		writeFirstTwoHopRowByTopFromSection(
			resolutionScratch,
			sections,
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
			sections,
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
	sections: readonly TwoHopSectionPlan[],
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
		sections,
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
		params.sections,
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
