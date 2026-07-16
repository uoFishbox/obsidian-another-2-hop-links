import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markVirtualScrollMeasurementRun,
	resetVirtualScrollMeasurementFrameForTests,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "../virtualScrollMeasurementFrame";

describe("virtual scroll measurement frame", () => {
	let frameCallbacks: FrameRequestCallback[];

	beforeEach(() => {
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
		vi.unstubAllGlobals();
	});

	it("keeps preview work deferred until the frame after measurement runs", () => {
		markVirtualScrollMeasurementRun();

		expect(shouldDeferPreviewActivationForVirtualScrollMeasurement()).toBe(true);
		expect(frameCallbacks).toHaveLength(1);

		frameCallbacks.shift()?.(16);

		expect(shouldDeferPreviewActivationForVirtualScrollMeasurement()).toBe(false);
	});

	it("coalesces multiple measurements from the same frame", () => {
		markVirtualScrollMeasurementRun();
		markVirtualScrollMeasurementRun();

		expect(frameCallbacks).toHaveLength(1);

		frameCallbacks.shift()?.(16);

		expect(shouldDeferPreviewActivationForVirtualScrollMeasurement()).toBe(false);
	});
});
