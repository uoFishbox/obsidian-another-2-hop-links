export interface VirtualListMeasurementState {
	sectionTop: number;
	viewportHeight: number;
	hasStableScrollMetrics: boolean;
	hasStableVisibleRange: boolean;
	measuredWidth: number | null;
	scrollContainerEl: HTMLElement | null;
}

export type VirtualListMeasurementStateHandle = VirtualListMeasurementState & {
	invalidateViewport(): void;
	updateFromLiveMetrics(
		metrics: { sectionTop: number; viewportHeight: number },
		isStable: boolean,
	): void;
};

export function createVirtualListMeasurementState(): VirtualListMeasurementStateHandle {
	return {
		sectionTop: 0,
		viewportHeight: 0,
		hasStableScrollMetrics: false,
		hasStableVisibleRange: false,
		measuredWidth: null,
		scrollContainerEl: null,
		invalidateViewport() {
			this.viewportHeight = 0;
			this.hasStableScrollMetrics = false;
		},
		updateFromLiveMetrics(
			metrics: { sectionTop: number; viewportHeight: number },
			isStable: boolean,
		) {
			this.sectionTop = metrics.sectionTop;
			this.viewportHeight = metrics.viewportHeight;
			this.hasStableScrollMetrics = isStable;
		},
	};
}
