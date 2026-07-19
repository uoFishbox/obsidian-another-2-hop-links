export interface VirtualListMeasurementState {
	sectionTop: number;
	viewportHeight: number;
	hasStableScrollMetrics: boolean;
	hasStableVisibleRange: boolean;
	measuredWidth: number | null;
	scrollContainerEl: HTMLElement | null;
}

export type VirtualListMeasurementPhase =
	| { readonly type: "unmeasured" }
	| {
			readonly type: "unstable";
			readonly sectionTop: number;
			readonly viewportHeight: number;
	  }
	| {
			readonly type: "stable";
			readonly sectionTop: number;
			readonly viewportHeight: number;
			readonly visibleRangeStable: boolean;
	  };

export type VirtualListMeasurementStateHandle = VirtualListMeasurementState & {
	invalidateViewport(): void;
	updateFromLiveMetrics(
		metrics: { sectionTop: number; viewportHeight: number },
		isStable: boolean,
	): void;
	resolvePhase(): VirtualListMeasurementPhase;
};

export function resolveVirtualListMeasurementPhase(
	state: VirtualListMeasurementState,
): VirtualListMeasurementPhase {
	if (state.viewportHeight <= 0) {
		return { type: "unmeasured" };
	}

	if (!state.hasStableScrollMetrics) {
		return {
			type: "unstable",
			sectionTop: state.sectionTop,
			viewportHeight: state.viewportHeight,
		};
	}

	return {
		type: "stable",
		sectionTop: state.sectionTop,
		viewportHeight: state.viewportHeight,
		visibleRangeStable: state.hasStableVisibleRange,
	};
}

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
		resolvePhase() {
			return resolveVirtualListMeasurementPhase(this);
		},
	};
}
