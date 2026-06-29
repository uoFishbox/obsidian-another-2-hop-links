import type { ScrollPhase } from "infrastructure/scroll/scrollTargetListeners";

export interface ScrollerViewportScrollPendingAfterScroll {
	readonly reconnectObserver: boolean;
	readonly refreshDependencies: boolean;
	readonly measureLayout: boolean;
}

export type ScrollerViewportScrollPhaseState =
	| { readonly type: "idle" }
	| {
			readonly type: "scrolling";
			readonly pendingAfterScroll: ScrollerViewportScrollPendingAfterScroll;
	  };

export type ScrollPhaseEffect =
	| { readonly type: "none" }
	| { readonly type: "scroll-start" }
	| { readonly type: "scroll-frame"; readonly measureScroll: true }
	| {
			readonly type: "scroll-idle";
			readonly refreshDependencies: boolean;
			readonly measureLayout: boolean;
			readonly measureScroll: boolean;
			readonly reconnectObserver: boolean;
	  };

export interface ScrollerViewportScrollPhaseTransition {
	readonly state: ScrollerViewportScrollPhaseState;
	readonly effect: ScrollPhaseEffect;
}

const NO_PENDING_AFTER_SCROLL: ScrollerViewportScrollPendingAfterScroll = {
	reconnectObserver: false,
	refreshDependencies: false,
	measureLayout: false,
};

export const INITIAL_SCROLLER_VIEWPORT_SCROLL_PHASE_STATE: ScrollerViewportScrollPhaseState =
	{
		type: "idle",
	};

export function reduceScrollerViewportPhase(
	state: ScrollerViewportScrollPhaseState,
	phase: ScrollPhase,
): ScrollerViewportScrollPhaseTransition {
	switch (phase) {
		case "start": {
			return {
				state: {
					type: "scrolling",
					pendingAfterScroll: NO_PENDING_AFTER_SCROLL,
				},
				effect:
					state.type === "idle" ? { type: "scroll-start" } : { type: "none" },
			};
		}
		case "scroll": {
			return {
				state: {
					type: "scrolling",
					pendingAfterScroll: {
						reconnectObserver: true,
						refreshDependencies:
							state.type === "scrolling"
								? state.pendingAfterScroll.refreshDependencies
								: false,
						measureLayout:
							state.type === "scrolling"
								? state.pendingAfterScroll.measureLayout
								: false,
					},
				},
				effect: { type: "scroll-frame", measureScroll: true },
			};
		}
		case "idle": {
			if (state.type === "idle") {
				return {
					state,
					effect: { type: "none" },
				};
			}

			const { pendingAfterScroll } = state;
			return {
				state: { type: "idle" },
				effect: {
					type: "scroll-idle",
					refreshDependencies:
						pendingAfterScroll.refreshDependencies ||
						pendingAfterScroll.reconnectObserver,
					measureLayout: pendingAfterScroll.measureLayout,
					measureScroll: !pendingAfterScroll.measureLayout,
					reconnectObserver: pendingAfterScroll.reconnectObserver,
				},
			};
		}
	}
}

export function markScrollerViewportDependencyRefreshAfterScroll(
	state: ScrollerViewportScrollPhaseState,
): ScrollerViewportScrollPhaseState {
	if (state.type === "idle") {
		return state;
	}

	return {
		type: "scrolling",
		pendingAfterScroll: {
			...state.pendingAfterScroll,
			refreshDependencies: true,
		},
	};
}

export function markScrollerViewportLayoutMeasurementAfterScroll(
	state: ScrollerViewportScrollPhaseState,
): ScrollerViewportScrollPhaseState {
	if (state.type === "idle") {
		return state;
	}

	return {
		type: "scrolling",
		pendingAfterScroll: {
			...state.pendingAfterScroll,
			measureLayout: true,
		},
	};
}
