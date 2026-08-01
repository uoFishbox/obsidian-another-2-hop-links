import type { FlatGridLayoutMetrics } from "../layoutMetrics";
import { computeColumnCount } from "../core/gridLayout";

export { computeColumnCount } from "../core/gridLayout";
export { computeVisibleCellWindow, computeVisibleRowRange } from "./flatGridRanges";
export type { VisibleCellWindow } from "./flatGridRanges";

export interface VirtualGridLayoutInput {
	containerWidth: number;
	minCellWidth: number;
	gap: number;
	maxColumns: number;
	rowHeight: number;
	cellCount: number;
	resolveRowHeight?: (cellWidth: number) => number;
}

export function computeVirtualGridLayout(
	input: VirtualGridLayoutInput,
): FlatGridLayoutMetrics {
	const columns = computeColumnCount(input);
	const gap = Math.max(0, input.gap);
	const containerWidth =
		input.containerWidth > 0 ? input.containerWidth : input.minCellWidth;
	const cellWidth =
		columns <= 1
			? containerWidth
			: Math.max(0, (containerWidth - gap * (columns - 1)) / columns);
	const rowHeight = Math.max(
		0,
		Math.floor(input.resolveRowHeight?.(cellWidth) ?? input.rowHeight),
	);
	const rowCount = input.cellCount > 0 ? Math.ceil(input.cellCount / columns) : 0;
	const rowStride = rowHeight + gap;
	const contentHeight =
		rowCount > 0 ? rowCount * rowHeight + (rowCount - 1) * gap : 0;

	return {
		containerWidth,
		columns,
		cellWidth,
		gap,
		rowHeight,
		rowCount,
		rowStride,
		contentHeight,
	};
}
