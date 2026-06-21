import { describe, expect, it } from "vitest";
import { applyScrollerViewportScrollPhase } from "../scrollerViewportScrollPhase";

function createState() {
	return {
		isScrollActive: false,
		needsObserverReconnectAfterScroll: false,
		needsDependencyRefreshAfterScroll: false,
		needsLayoutMeasurementAfterScroll: false,
		becameActive: false,
		becameIdle: false,
		shouldRefreshDependencies: false,
		shouldMeasureLayout: false,
		shouldMeasureScroll: false,
		shouldReconnectObserver: false,
	};
}

describe("applyScrollerViewportScrollPhase", () => {
	it("marks scroll start as active once", () => {
		const state = createState();

		applyScrollerViewportScrollPhase(state, "start");

		expect(state.isScrollActive).toBe(true);
		expect(state.becameActive).toBe(true);
		expect(state.becameIdle).toBe(false);
		expect(state.shouldRefreshDependencies).toBe(false);
		expect(state.shouldMeasureLayout).toBe(false);
		expect(state.shouldMeasureScroll).toBe(false);
		expect(state.shouldReconnectObserver).toBe(false);

		state.becameActive = false;
		applyScrollerViewportScrollPhase(state, "start");
		expect(state.becameActive).toBe(false);
	});

	it("records observer reconnect work during scroll", () => {
		const state = createState();
		state.isScrollActive = true;

		applyScrollerViewportScrollPhase(state, "scroll");

		expect(state.isScrollActive).toBe(true);
		expect(state.needsObserverReconnectAfterScroll).toBe(true);
		expect(state.shouldMeasureScroll).toBe(true);
		expect(state.becameActive).toBe(false);
		expect(state.becameIdle).toBe(false);
	});

	it("flushes pending work on idle", () => {
		const state = createState();
		state.isScrollActive = true;
		state.needsObserverReconnectAfterScroll = true;
		state.needsDependencyRefreshAfterScroll = false;
		state.needsLayoutMeasurementAfterScroll = true;

		applyScrollerViewportScrollPhase(state, "idle");

		expect(state.isScrollActive).toBe(false);
		expect(state.needsObserverReconnectAfterScroll).toBe(false);
		expect(state.needsDependencyRefreshAfterScroll).toBe(false);
		expect(state.needsLayoutMeasurementAfterScroll).toBe(false);
		expect(state.becameActive).toBe(false);
		expect(state.becameIdle).toBe(true);
		expect(state.shouldRefreshDependencies).toBe(true);
		expect(state.shouldMeasureLayout).toBe(true);
		expect(state.shouldMeasureScroll).toBe(false);
		expect(state.shouldReconnectObserver).toBe(true);
	});
});
