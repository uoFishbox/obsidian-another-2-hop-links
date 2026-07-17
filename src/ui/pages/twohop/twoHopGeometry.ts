import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";
import type { TwoHopSnapshot } from "./twoHopSnapshot";

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
			readonly sectionIndex: number;
			readonly rowIndex: number;
			readonly columnIndex: number;
	  }
	| {
			readonly kind: "item";
			readonly sectionIndex: number;
			readonly rowIndex: number;
			readonly columnIndex: number;
			readonly itemIndex: number;
			readonly item: TwoHopVirtualListItem;
	  }
	| {
			readonly kind: "load-more";
			readonly sectionIndex: number;
			readonly rowIndex: number;
			readonly columnIndex: number;
	  };

export interface TwoHopRowRange {
	readonly start: number;
	readonly end: number;
}

/** Builds compact section-prefix geometry. No per-row or per-cell objects are created. */
export function createTwoHopGeometry(
	snapshot: TwoHopSnapshot,
	layout: ViewPlanLayoutMetrics,
): TwoHopGeometry {
	const sectionCount = snapshot.sections.length;
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
		const section = snapshot.sections[sectionIndex];
		const cellCount =
			1 + section.visibleItemCount + (section.showLoadMore ? 1 : 0);
		const sectionRowCount = Math.ceil(cellCount / columns);
		const contentHeight =
			sectionRowCount > 0
				? sectionRowCount * rowHeight + (sectionRowCount - 1) * (rowStride - rowHeight)
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
	snapshot: TwoHopSnapshot,
	geometry: TwoHopGeometry,
	rowIndex: number,
	columnIndex: number,
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
	const section = snapshot.sections[sectionIndex];
	const rowInSection = rowIndex - geometry.firstRowBySection[sectionIndex];
	const cellIndex = rowInSection * geometry.columns + columnIndex;

	if (cellIndex === 0) {
		return { kind: "header", sectionIndex, rowIndex, columnIndex };
	}

	const visibleItemOffset = cellIndex - 1;
	if (visibleItemOffset < section.visibleItemCount) {
		const itemIndex = section.visibleItemSourceIndexes[visibleItemOffset];
		const item = section.items[itemIndex];
		if (!item) return null;
		return {
			kind: "item",
			sectionIndex,
			rowIndex,
			columnIndex,
			itemIndex,
			item,
		};
	}

	if (section.showLoadMore && visibleItemOffset === section.visibleItemCount) {
		return { kind: "load-more", sectionIndex, rowIndex, columnIndex };
	}

	return null;
}

export function resolveTwoHopVisibleRows(
	geometry: TwoHopGeometry,
	scrollOffset: number,
	viewportHeight: number,
): TwoHopRowRange {
	if (geometry.rowCount === 0 || viewportHeight <= 0) {
		return { start: 0, end: 0 };
	}

	const start = resolveRowAtOffset(geometry, Math.max(0, scrollOffset));
	const lastOffset = Math.max(0, scrollOffset + viewportHeight - 1);
	const end = Math.min(geometry.rowCount, resolveRowAtOffset(geometry, lastOffset) + 1);
	return { start, end };
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

function resolveRowAtOffset(geometry: TwoHopGeometry, offset: number): number {
	let low = 0;
	let high = geometry.topBySection.length - 1;
	let sectionIndex = 0;

	while (low <= high) {
		const middle = (low + high) >>> 1;
		const top = geometry.topBySection[middle];
		const bottom = top + geometry.heightBySection[middle];
		if (offset < top) {
			high = middle - 1;
		} else if (offset >= bottom) {
			sectionIndex = Math.min(middle + 1, geometry.topBySection.length - 1);
			low = middle + 1;
		} else {
			sectionIndex = middle;
			break;
		}
	}

	const firstRow = geometry.firstRowBySection[sectionIndex] ?? 0;
	const sectionRowCount = geometry.rowCountBySection[sectionIndex] ?? 0;
	const rowInSection = Math.floor(
		Math.max(0, offset - (geometry.topBySection[sectionIndex] ?? 0)) /
			geometry.rowStride,
	);
	return Math.min(
		Math.max(0, geometry.rowCount - 1),
		firstRow + Math.min(Math.max(0, sectionRowCount - 1), rowInSection),
	);
}
