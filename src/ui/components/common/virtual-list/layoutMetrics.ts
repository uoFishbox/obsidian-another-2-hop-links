export interface VirtualRowLayoutMetrics {
	containerWidth: number;
	columns: number;
	cellWidth: number;
	gap: number;
	rowHeight: number;
	contentHeight: number;
}

export interface FlatGridLayoutMetrics extends VirtualRowLayoutMetrics {
	rowCount: number;
	rowStride: number;
}

export interface ViewPlanRowLayoutMetrics
	extends VirtualRowLayoutMetrics {
	sectionMarginBottom: number;
}
