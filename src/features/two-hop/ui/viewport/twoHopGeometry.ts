import type { ViewPlanLayoutMetrics } from "ui/virtualization/svelte/viewPlanLayout";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";
import type { TwoHopDocument } from "features/two-hop/ui/twoHopDocument";

export interface TwoHopGeometry {
	readonly columns: number;
	readonly rowHeight: number;
	readonly rowStride: number;
	readonly rowCount: number;
	readonly totalHeight: number;
	readonly firstRowBySection: Uint32Array;
	readonly rowCountBySection: Uint32Array;
	readonly topBySection: Float64Array;
	readonly heightBySection: Float64Array;
}

export type TwoHopResolvedCell =
	| {
			readonly kind: "header";
			readonly logicalKey: string;
			readonly sectionIndex: number;
			readonly rowIndex: number;
			readonly columnIndex: number;
	  }
	| {
			readonly kind: "item";
			readonly logicalKey: string;
			readonly sectionIndex: number;
			readonly rowIndex: number;
			readonly columnIndex: number;
			readonly itemIndex: number;
			readonly item: TwoHopVirtualListItem;
	  }
	| {
			readonly kind: "load-more";
			readonly logicalKey: string;
			readonly sectionIndex: number;
			readonly rowIndex: number;
			readonly columnIndex: number;
	  };

export interface TwoHopRowRange {
	start: number;
	end: number;
}

export interface TwoHopResolvedCellBuffer {
	kind: TwoHopResolvedCell["kind"];
	logicalKey: string;
	sectionIndex: number;
	rowIndex: number;
	columnIndex: number;
	itemIndex: number;
	item: TwoHopVirtualListItem | null;
}

export interface TwoHopResolvedRowBuffer {
	sectionIndex: number;
	rowIndex: number;
	rowInSection: number;
	top: number;
}

export function createTwoHopResolvedCellBuffer(): TwoHopResolvedCellBuffer {
	return {
		kind: "header",
		logicalKey: "",
		sectionIndex: -1,
		rowIndex: -1,
		columnIndex: -1,
		itemIndex: -1,
		item: null,
	};
}

export function createTwoHopResolvedRowBuffer(): TwoHopResolvedRowBuffer {
	return {
		sectionIndex: -1,
		rowIndex: -1,
		rowInSection: -1,
		top: 0,
	};
}

/** Builds compact section-prefix geometry. No per-row or per-cell objects are created. */
export function compileFixedGridLayout(
	document: TwoHopDocument,
	layout: ViewPlanLayoutMetrics,
): TwoHopGeometry {
	const sectionCount = document.sections.length;
	const columns = Math.max(1, Math.floor(layout.columns));
	const rowHeight = Math.max(1, layout.rowHeight);
	const rowStride = rowHeight + Math.max(0, layout.gap);
	const firstRowBySection = new Uint32Array(sectionCount);
	const rowCountBySection = new Uint32Array(sectionCount);
	const topBySection = new Float64Array(sectionCount);
	const heightBySection = new Float64Array(sectionCount);
	const sectionMarginBottom = Math.max(0, layout.sectionMarginBottom);
	let rowCount = 0;
	let top = 0;

	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const section = document.sections[sectionIndex];
		const cellCount =
			1 + section.visibleItemCount + (section.loadMore === null ? 0 : 1);
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
		heightBySection[sectionIndex] = sectionHeight;
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
		heightBySection,
	};
}

/** Resolves a global row/column to section data using one binary search and arithmetic. */
export function resolveTwoHopCell(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	rowIndex: number,
	columnIndex: number,
): TwoHopResolvedCell | null {
	return resolveTwoHopCellInto(
		document,
		geometry,
		rowIndex,
		columnIndex,
		createTwoHopResolvedCellBuffer(),
	);
}

/** Resolves into caller-owned storage for allocation-free physical slot binding. */
export function resolveTwoHopCellInto(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	rowIndex: number,
	columnIndex: number,
	target: TwoHopResolvedCellBuffer,
): TwoHopResolvedCell | null {
	if (
		rowIndex < 0 ||
		rowIndex >= geometry.rowCount ||
		columnIndex < 0 ||
		columnIndex >= geometry.columns
	) {
		return null;
	}

	const sectionIndex = resolveSectionIndexForRow(geometry, rowIndex);
	if (sectionIndex < 0) return null;
	const rowInSection = rowIndex - geometry.firstRowBySection[sectionIndex];
	return resolveTwoHopCellForSectionInto(
		document,
		geometry,
		sectionIndex,
		rowIndex,
		rowInSection,
		columnIndex,
		target,
	);
}

/** Resolves row geometry once for positioning and all column binds. */
export function resolveTwoHopRowInto(
	geometry: TwoHopGeometry,
	rowIndex: number,
	target: TwoHopResolvedRowBuffer,
): boolean {
	if (rowIndex < 0 || rowIndex >= geometry.rowCount) return false;
	const sectionIndex = resolveSectionIndexForRow(geometry, rowIndex);
	if (sectionIndex < 0) return false;
	const rowInSection = rowIndex - geometry.firstRowBySection[sectionIndex];
	target.sectionIndex = sectionIndex;
	target.rowIndex = rowIndex;
	target.rowInSection = rowInSection;
	target.top =
		geometry.topBySection[sectionIndex] + rowInSection * geometry.rowStride;
	return true;
}

/** Resolves a cell from caller-owned row geometry without another section search. */
export function resolveTwoHopCellInRowInto(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	row: TwoHopResolvedRowBuffer,
	columnIndex: number,
	target: TwoHopResolvedCellBuffer,
): TwoHopResolvedCell | null {
	if (columnIndex < 0 || columnIndex >= geometry.columns) return null;
	return resolveTwoHopCellForSectionInto(
		document,
		geometry,
		row.sectionIndex,
		row.rowIndex,
		row.rowInSection,
		columnIndex,
		target,
	);
}

function resolveTwoHopCellForSectionInto(
	document: TwoHopDocument,
	geometry: TwoHopGeometry,
	sectionIndex: number,
	rowIndex: number,
	rowInSection: number,
	columnIndex: number,
	target: TwoHopResolvedCellBuffer,
): TwoHopResolvedCell | null {
	const section = document.sections[sectionIndex];
	if (!section) return null;
	const cellIndex = rowInSection * geometry.columns + columnIndex;

	if (cellIndex === 0) {
		target.kind = "header";
		target.logicalKey = section.header.logicalKey;
		target.sectionIndex = sectionIndex;
		target.rowIndex = rowIndex;
		target.columnIndex = columnIndex;
		target.itemIndex = -1;
		target.item = null;
		return target as unknown as Extract<TwoHopResolvedCell, { kind: "header" }>;
	}

	const visibleItemOffset = cellIndex - 1;
	if (visibleItemOffset < section.visibleItemCount) {
		const item = section.getItem(visibleItemOffset);
		if (!item) return null;
		target.kind = "item";
		target.logicalKey = `item:${section.key}:${item.virtualKey}`;
		target.sectionIndex = sectionIndex;
		target.rowIndex = rowIndex;
		target.columnIndex = columnIndex;
		target.itemIndex = visibleItemOffset;
		target.item = item;
		return target as unknown as Extract<TwoHopResolvedCell, { kind: "item" }>;
	}

	if (section.loadMore && visibleItemOffset === section.visibleItemCount) {
		target.kind = "load-more";
		target.logicalKey = section.loadMore.logicalKey;
		target.sectionIndex = sectionIndex;
		target.rowIndex = rowIndex;
		target.columnIndex = columnIndex;
		target.itemIndex = -1;
		target.item = null;
		return target as unknown as Extract<TwoHopResolvedCell, { kind: "load-more" }>;
	}

	return null;
}

export function resolveTwoHopVisibleRows(
	geometry: TwoHopGeometry,
	scrollOffset: number,
	viewportHeight: number,
): TwoHopRowRange {
	const range = { start: 0, end: 0 };
	resolveTwoHopVisibleRowsInto(range, geometry, scrollOffset, viewportHeight);
	return range;
}

/** Resolves visible rows into caller-owned storage for the scroll hot path. */
export function resolveTwoHopVisibleRowsInto(
	target: TwoHopRowRange,
	geometry: TwoHopGeometry,
	scrollOffset: number,
	viewportHeight: number,
): void {
	const viewportTop = Math.max(0, scrollOffset);
	const viewportBottom = Math.min(
		geometry.totalHeight,
		scrollOffset + viewportHeight,
	);
	if (
		geometry.rowCount === 0 ||
		viewportHeight <= 0 ||
		viewportBottom <= viewportTop
	) {
		target.start = 0;
		target.end = 0;
		return;
	}

	target.start = resolveFirstRowEndingAfter(geometry, viewportTop);
	target.end = resolveFirstRowStartingAtOrAfter(geometry, viewportBottom);
}

/** Resolves the first row whose bottom is below the supplied local scroll offset. */
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
		if (rowIndex < firstRow) {
			high = middle - 1;
		} else if (rowIndex >= endRow) {
			low = middle + 1;
		} else {
			return middle;
		}
	}

	return -1;
}

/**
 * Finds the first row whose bottom exceeds the viewport top.
 *
 * Binary-searches section tops by pixel offset (O(log sectionCount)) and
 * resolves the row within the section arithmetically (O(1)), avoiding the
 * previous O(log rowCount × log sectionCount) nested binary search that
 * called resolveTwoHopRowTop (and thus resolveSectionIndexForRow) per step.
 */
function resolveFirstRowEndingAfter(geometry: TwoHopGeometry, offset: number): number {
	const pixelTarget = offset - geometry.rowHeight;
	const sectionCount = geometry.topBySection.length;

	let low = 0;
	let high = sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		const lastRowTopInSection =
			geometry.topBySection[mid] +
			(geometry.rowCountBySection[mid] - 1) * geometry.rowStride;
		if (lastRowTopInSection <= pixelTarget) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	if (low >= sectionCount) return geometry.rowCount;

	const sectionIndex = low;
	const sectionTop = geometry.topBySection[sectionIndex];
	const rowsInSection = geometry.rowCountBySection[sectionIndex];

	let rowInSection = Math.max(
		0,
		Math.floor((pixelTarget - sectionTop) / geometry.rowStride) + 1,
	);
	rowInSection = Math.min(rowInSection, rowsInSection - 1);

	// Absorb floating-point rounding from the division by verifying against
	// the exact same multiplication used by resolveTwoHopRowTop.
	if (rowInSection < rowsInSection - 1) {
		const candidateBottom =
			sectionTop + rowInSection * geometry.rowStride + geometry.rowHeight;
		if (candidateBottom <= offset) rowInSection += 1;
	}
	if (rowInSection > 0) {
		const prevBottom =
			sectionTop + (rowInSection - 1) * geometry.rowStride + geometry.rowHeight;
		if (prevBottom > offset) rowInSection -= 1;
	}

	return geometry.firstRowBySection[sectionIndex] + rowInSection;
}

/**
 * Finds the first row whose top is at or above the viewport bottom.
 *
 * Binary-searches section tops by pixel offset (O(log sectionCount)) and
 * resolves the row within the section arithmetically (O(1)), avoiding the
 * previous O(log rowCount × log sectionCount) nested binary search.
 */
function resolveFirstRowStartingAtOrAfter(
	geometry: TwoHopGeometry,
	offset: number,
): number {
	const sectionCount = geometry.topBySection.length;

	let low = 0;
	let high = sectionCount;
	while (low < high) {
		const mid = (low + high) >>> 1;
		const lastRowTopInSection =
			geometry.topBySection[mid] +
			(geometry.rowCountBySection[mid] - 1) * geometry.rowStride;
		if (lastRowTopInSection < offset) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	if (low >= sectionCount) return geometry.rowCount;

	const sectionIndex = low;
	const sectionTop = geometry.topBySection[sectionIndex];
	const rowsInSection = geometry.rowCountBySection[sectionIndex];

	let rowInSection = Math.max(
		0,
		Math.ceil((offset - sectionTop) / geometry.rowStride),
	);
	rowInSection = Math.min(rowInSection, rowsInSection - 1);

	// Absorb floating-point rounding from the division by verifying against
	// the exact same multiplication used by resolveTwoHopRowTop.
	if (rowInSection < rowsInSection - 1) {
		const candidateTop = sectionTop + rowInSection * geometry.rowStride;
		if (candidateTop < offset) rowInSection += 1;
	}
	if (rowInSection > 0) {
		const prevTop = sectionTop + (rowInSection - 1) * geometry.rowStride;
		if (prevTop >= offset) rowInSection -= 1;
	}

	return geometry.firstRowBySection[sectionIndex] + rowInSection;
}
