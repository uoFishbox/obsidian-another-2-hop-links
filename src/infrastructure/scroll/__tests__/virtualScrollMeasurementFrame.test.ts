import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markVirtualScrollMeasurementRun,
	resetVirtualScrollMeasurementFrameForTests,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "../virtualScrollMeasurementFrame";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";

describe("virtual scroll measurement frame", () => {
	let frameCallbacks: FrameRequestCallback[];

	beforeEach(() => {
		resetCCLDevMeasurements();
		frameCallbacks = [];
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn((callback: FrameRequestCallback) => {
				frameCallbacks.push(callback);
				return frameCallbacks.length;
			}),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
	});

	afterEach(() => {
		resetVirtualScrollMeasurementFrameForTests();
		resetCCLDevMeasurements();
		vi.unstubAllGlobals();
	});

	it("keeps preview work deferred until the frame after measurement runs", () => {
		markVirtualScrollMeasurementRun();

		expect(shouldDeferPreviewActivationForVirtualScrollMeasurement()).toBe(true);
		expect(frameCallbacks).toHaveLength(1);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"virtualScroll.measurementMarker.animationFrame"
			].count,
		).toBe(1);

		frameCallbacks.shift()?.(16);

		expect(shouldDeferPreviewActivationForVirtualScrollMeasurement()).toBe(false);
	});

	it("coalesces multiple measurements from the same frame", () => {
		markVirtualScrollMeasurementRun();
		markVirtualScrollMeasurementRun();

		expect(frameCallbacks).toHaveLength(1);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"virtualScroll.measurementMarker.animationFrame"
			].count,
		).toBe(1);

		frameCallbacks.shift()?.(16);

		expect(shouldDeferPreviewActivationForVirtualScrollMeasurement()).toBe(false);
	});
});
