import { EMPTY_ROW_RANGE, isEmptyRange, type RowRange } from "../rowRange";

export type VisibleCellWindow = RowRange;

export function computeVisibleRowRange(params: {
	scrollTop: number;
	viewportHeight: number;
	sectionTop: number;
	rowHeight: number;
	gap: number;
	rowCount: number;
	overscanRows: number;
}): RowRange {
	if (params.rowCount <= 0) {
		return EMPTY_ROW_RANGE;
	}

	const rowStride = params.rowHeight + params.gap;
	const contentHeight =
		params.rowCount * params.rowHeight + (params.rowCount - 1) * params.gap;
	if (rowStride <= 0) {
		return { start: 0, end: params.rowCount };
	}

	const sectionViewportTop = params.scrollTop - params.sectionTop;
	const sectionViewportBottom =
		params.scrollTop + params.viewportHeight - params.sectionTop;

	if (sectionViewportBottom <= 0 || sectionViewportTop >= contentHeight) {
		return EMPTY_ROW_RANGE;
	}

	const firstVisibleRow = Math.floor(Math.max(0, sectionViewportTop) / rowStride);
	const lastVisibleRow = Math.floor(
		Math.max(0, sectionViewportBottom - 1) / rowStride,
	);
	const start = Math.max(0, firstVisibleRow - params.overscanRows);
	const end = Math.min(params.rowCount, lastVisibleRow + params.overscanRows + 1);

	return { start, end };
}

export function computeVisibleCellWindow(params: {
	cellCount: number;
	columns: number;
	rowRange: RowRange;
}): VisibleCellWindow {
	if (params.cellCount <= 0 || params.columns <= 0 || isEmptyRange(params.rowRange)) {
		return EMPTY_ROW_RANGE;
	}

	const start = params.rowRange.start * params.columns;
	const end = Math.min(params.cellCount, params.rowRange.end * params.columns);

	return { start, end };
}
