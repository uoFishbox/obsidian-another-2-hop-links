export function computeCellPosition(params: {
	index: number;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}): {
	row: number;
	column: number;
	top: number;
	left: number;
	width: number;
	height: number;
} {
	const row = Math.floor(params.index / params.columns);
	const column = params.index % params.columns;

	return {
		row,
		column,
		top: row * (params.rowHeight + params.gap),
		left: column * (params.cellWidth + params.gap),
		width: params.cellWidth,
		height: params.rowHeight,
	};
}
