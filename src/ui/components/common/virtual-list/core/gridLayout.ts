export function computeColumnCount(params: {
	containerWidth: number;
	minCellWidth: number;
	gap: number;
	maxColumns: number;
}): number {
	const minCellWidth = Math.max(1, Math.floor(params.minCellWidth));
	const gap = Math.max(0, Math.floor(params.gap));
	const maxColumns = Math.max(1, Math.floor(params.maxColumns));
	const containerWidth =
		params.containerWidth > 0 ? params.containerWidth : minCellWidth;
	const autoFillColumns = Math.floor(
		(containerWidth + gap) / (minCellWidth + gap),
	);

	return Math.max(1, Math.min(maxColumns, autoFillColumns || 1));
}
