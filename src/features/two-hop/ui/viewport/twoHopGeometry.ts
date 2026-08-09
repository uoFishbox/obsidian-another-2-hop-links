import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";
import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import type { MutableStableScrollTopBand } from "ui/virtualization/core/scrollWindowGate";

export interface TwoHopGeometry {
	readonly columns: number;
	readonly rowHeight: number;
	readonly rowStride: number;
	readonly rowCount: number;
	readonly totalHeight: number;
	readonly firstRowBySection: Uint32Array;
	readonly rowCountBySection: Uint32Array;
	readonly topBySection: Float64Array;
}

export interface TwoHopRowRange {
	start: number;
	end: number;
}

/** Builds section-prefix geometry without per-row or per-cell bindings. */
export function compileFixedGridLayout(
	sections: readonly TwoHopSectionModel[],
	layout: ViewPlanLayoutMetrics,
): TwoHopGeometry {
	const sectionCount = sections.length;
	const columns = Math.max(1, Math.floor(layout.columns));
	const rowHeight = Math.max(1, layout.rowHeight);
	const rowStride = rowHeight + Math.max(0, layout.gap);
	const firstRowBySection = new Uint32Array(sectionCount);
	const rowCountBySection = new Uint32Array(sectionCount);
	const topBySection = new Float64Array(sectionCount);
	const sectionMarginBottom = Math.max(0, layout.sectionMarginBottom);
	let rowCount = 0;
	let top = 0;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const section = sections[sectionIndex];
		const hasLoadMore = section.visibleCount < section.items.length;
		const cellCount = 1 + section.visibleCount + (hasLoadMore ? 1 : 0);
		const sectionRowCount = Math.ceil(cellCount / columns);
		const contentHeight =
			sectionRowCount > 0
				? sectionRowCount * rowHeight +
					(sectionRowCount - 1) * (rowStride - rowHeight)
				: 0;
		const sectionHeight = contentHeight + sectionMarginBottom;

		firstRowBySection[sectionIndex] = rowCount;
		rowCountBySection[sectionIndex] = sectionRowCount;
		topBySection[sectionIndex] = top;
		rowCount += sectionRowCount;
		top += sectionHeight;
	}

	return {
		columns,
		rowHeight,
		rowStride,
		rowCount,
		totalHeight: top,
		firstRowBySection,
		rowCountBySection,
		topBySection,
	};
}

/** Resolves visible rows and their open stable interval into caller-owned storage. */
export function resolveTwoHopVisibleWindowInto(
	rangeTarget: TwoHopRowRange,
	stableBandTarget: MutableStableScrollTopBand,
	geometry: TwoHopGeometry,
	scrollOffset: number,
	viewportHeight: number,
): void {
	const viewportTop = Math.max(0, scrollOffset);
	const viewportBottom = Math.min(
		geometry.totalHeight,
		scrollOffset + viewportHeight,
	);
	if (geometry.rowCount === 0 || viewportHeight <= 0) {
		writeEmptyRange(rangeTarget);
		writeInvalidStableBand(stableBandTarget);
		return;
	}
	if (viewportBottom <= viewportTop) {
		writeEmptyRange(rangeTarget);
		if (scrollOffset + viewportHeight <= 0) {
			stableBandTarget.min = Number.NEGATIVE_INFINITY;
			stableBandTarget.max = -viewportHeight;
			return;
		}
		if (scrollOffset >= geometry.totalHeight) {
			stableBandTarget.min = geometry.totalHeight;
			stableBandTarget.max = Number.POSITIVE_INFINITY;
			return;
		}
		writeInvalidStableBand(stableBandTarget);
		return;
	}

	rangeTarget.start = resolveFirstRowEndingAfter(geometry, viewportTop);
	rangeTarget.end = resolveFirstRowStartingAtOrAfter(geometry, viewportBottom);
	writeVisibleRangeStableBand(
		stableBandTarget,
		geometry,
		rangeTarget,
		viewportHeight,
	);
}

function writeVisibleRangeStableBand(
	target: MutableStableScrollTopBand,
	geometry: TwoHopGeometry,
	range: Readonly<TwoHopRowRange>,
	viewportHeight: number,
): void {
	const startMin =
		range.start === 0
			? Number.NEGATIVE_INFINITY
			: resolveTwoHopRowTop(geometry, range.start - 1) + geometry.rowHeight;
	const startMax =
		range.start >= geometry.rowCount
			? Number.POSITIVE_INFINITY
			: resolveTwoHopRowTop(geometry, range.start) + geometry.rowHeight;
	const endMin =
		range.end === 0
			? Number.NEGATIVE_INFINITY
			: resolveTwoHopRowTop(geometry, range.end - 1) - viewportHeight;
	const endMax =
		range.end >= geometry.rowCount
			? Number.POSITIVE_INFINITY
			: resolveTwoHopRowTop(geometry, range.end) - viewportHeight;

	target.min = Math.max(startMin, endMin, -viewportHeight);
	target.max = Math.min(startMax, endMax, geometry.totalHeight);
	if (target.min >= target.max) writeInvalidStableBand(target);
}

function writeEmptyRange(target: TwoHopRowRange): void {
	target.start = 0;
	target.end = 0;
}

function writeInvalidStableBand(target: MutableStableScrollTopBand): void {
	target.min = Number.POSITIVE_INFINITY;
	target.max = Number.NEGATIVE_INFINITY;
}

export function resolveTwoHopRowFromScrollOffset(
	geometry: TwoHopGeometry,
	scrollOffset: number,
): number | null {
	if (geometry.rowCount === 0) return null;
	const rowIndex = resolveFirstRowEndingAfter(geometry, Math.max(0, scrollOffset));
	return rowIndex < geometry.rowCount ? rowIndex : null;
}

export function resolveTwoHopRowTop(
	geometry: TwoHopGeometry,
	rowIndex: number,
): number {
	const sectionIndex = resolveSectionIndexForRow(geometry, rowIndex);
	if (sectionIndex < 0) return 0;
	return (
		geometry.topBySection[sectionIndex] +
		(rowIndex - geometry.firstRowBySection[sectionIndex]) * geometry.rowStride
	);
}

export function resolveSectionIndexForRow(
	geometry: TwoHopGeometry,
	rowIndex: number,
): number {
	let low = 0;
	let high = geometry.firstRowBySection.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const firstRow = geometry.firstRowBySection[middle];
		const endRow = firstRow + geometry.rowCountBySection[middle];
		if (rowIndex < firstRow) high = middle - 1;
		else if (rowIndex >= endRow) low = middle + 1;
		else return middle;
	}
	return -1;
}

function resolveFirstRowEndingAfter(geometry: TwoHopGeometry, offset: number): number {
	const pixelTarget = offset - geometry.rowHeight;
	const sectionCount = geometry.topBySection.length;
	let low = 0;
	let high = sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		const lastRowTop =
			geometry.topBySection[mid] +
			(geometry.rowCountBySection[mid] - 1) * geometry.rowStride;
		if (lastRowTop <= pixelTarget) low = mid + 1;
		else high = mid;
	}
	if (low >= sectionCount) return geometry.rowCount;

	const sectionTop = geometry.topBySection[low];
	const rowsInSection = geometry.rowCountBySection[low];
	let rowInSection = Math.max(
		0,
		Math.floor((pixelTarget - sectionTop) / geometry.rowStride) + 1,
	);
	rowInSection = Math.min(rowInSection, rowsInSection - 1);
	if (rowInSection < rowsInSection - 1) {
		const bottom =
			sectionTop + rowInSection * geometry.rowStride + geometry.rowHeight;
		if (bottom <= offset) rowInSection += 1;
	}
	if (rowInSection > 0) {
		const previousBottom =
			sectionTop + (rowInSection - 1) * geometry.rowStride + geometry.rowHeight;
		if (previousBottom > offset) rowInSection -= 1;
	}
	return geometry.firstRowBySection[low] + rowInSection;
}

function resolveFirstRowStartingAtOrAfter(
	geometry: TwoHopGeometry,
	offset: number,
): number {
	const sectionCount = geometry.topBySection.length;
	let low = 0;
	let high = sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		const lastRowTop =
			geometry.topBySection[mid] +
			(geometry.rowCountBySection[mid] - 1) * geometry.rowStride;
		if (lastRowTop < offset) low = mid + 1;
		else high = mid;
	}
	if (low >= sectionCount) return geometry.rowCount;

	const sectionTop = geometry.topBySection[low];
	const rowsInSection = geometry.rowCountBySection[low];
	let rowInSection = Math.max(
		0,
		Math.ceil((offset - sectionTop) / geometry.rowStride),
	);
	rowInSection = Math.min(rowInSection, rowsInSection - 1);
	if (rowInSection < rowsInSection - 1) {
		const top = sectionTop + rowInSection * geometry.rowStride;
		if (top < offset) rowInSection += 1;
	}
	if (rowInSection > 0) {
		const previousTop = sectionTop + (rowInSection - 1) * geometry.rowStride;
		if (previousTop >= offset) rowInSection -= 1;
	}
	return geometry.firstRowBySection[low] + rowInSection;
}
