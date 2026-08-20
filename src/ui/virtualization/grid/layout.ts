import type { FlatGridLayoutMetrics } from "../model/layoutMetrics";
import { computeColumnCount } from "./columnCount";

export { computeColumnCount } from "./columnCount";

export interface FlatGridLayoutInput {
	containerWidth: number;
	minCellWidth: number;
	gap: number;
	maxColumns: number;
	rowHeight: number;
	cellCount: number;
	resolveRowHeight?: (cellWidth: number) => number;
}

export function computeFlatGridLayout(
	input: FlatGridLayoutInput,
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
