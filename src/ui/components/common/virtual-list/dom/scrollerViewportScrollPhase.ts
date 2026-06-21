import type { ScrollPhase } from "infrastructure/scroll/scrollTargetListeners";

export function applyScrollerViewportScrollPhase(
	state: {
		isScrollActive: boolean;
		needsObserverReconnectAfterScroll: boolean;
		needsDependencyRefreshAfterScroll: boolean;
		needsLayoutMeasurementAfterScroll: boolean;
		becameActive: boolean;
		becameIdle: boolean;
		shouldRefreshDependencies: boolean;
		shouldMeasureLayout: boolean;
		shouldMeasureScroll: boolean;
		shouldReconnectObserver: boolean;
	},
	phase: ScrollPhase,
): void {
	switch (phase) {
		case "start": {
			const wasActive = state.isScrollActive;
			state.isScrollActive = true;
			state.needsObserverReconnectAfterScroll = false;
			state.needsDependencyRefreshAfterScroll = false;
			state.needsLayoutMeasurementAfterScroll = false;
			state.becameActive = !wasActive;
			state.becameIdle = false;
			state.shouldRefreshDependencies = false;
			state.shouldMeasureLayout = false;
			state.shouldMeasureScroll = false;
			state.shouldReconnectObserver = false;
			break;
		}
		case "scroll": {
			state.needsObserverReconnectAfterScroll = true;
			state.becameActive = false;
			state.becameIdle = false;
			state.shouldRefreshDependencies = false;
			state.shouldMeasureLayout = false;
			state.shouldMeasureScroll = true;
			state.shouldReconnectObserver = false;
			break;
		}
		case "idle": {
			if (!state.isScrollActive) {
				state.becameActive = false;
				state.becameIdle = false;
				state.shouldRefreshDependencies = false;
				state.shouldMeasureLayout = false;
				state.shouldMeasureScroll = false;
				state.shouldReconnectObserver = false;
				break;
			}

			const shouldRefreshDependencies =
				state.needsDependencyRefreshAfterScroll ||
				state.needsObserverReconnectAfterScroll;
			const shouldMeasureLayout = state.needsLayoutMeasurementAfterScroll;
			const shouldReconnectObserver =
				state.needsObserverReconnectAfterScroll;

			state.isScrollActive = false;
			state.needsObserverReconnectAfterScroll = false;
			state.needsDependencyRefreshAfterScroll = false;
			state.needsLayoutMeasurementAfterScroll = false;
			state.becameActive = false;
			state.becameIdle = true;
			state.shouldRefreshDependencies = shouldRefreshDependencies;
			state.shouldMeasureLayout = shouldMeasureLayout;
			state.shouldMeasureScroll = !shouldMeasureLayout;
			state.shouldReconnectObserver = shouldReconnectObserver;
			break;
		}
	}
}
