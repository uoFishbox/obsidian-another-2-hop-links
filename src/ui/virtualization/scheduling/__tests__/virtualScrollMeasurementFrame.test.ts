import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	markVirtualScrollMeasurementRun,
	readVirtualScrollMeasurementEpoch,
	resetVirtualScrollMeasurementFrameForTests,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "../virtualScrollMeasurementFrame";

describe("virtual scroll measurement frame", () => {
	beforeEach(() => {
		resetVirtualScrollMeasurementFrameForTests();
	});

	afterEach(() => {
		resetVirtualScrollMeasurementFrameForTests();
		vi.unstubAllGlobals();
	});

	it("reports measurement work after the previously observed epoch", () => {
		const previouslyObservedEpoch = readVirtualScrollMeasurementEpoch();

		markVirtualScrollMeasurementRun();

		expect(
			shouldDeferPreviewActivationForVirtualScrollMeasurement(
				previouslyObservedEpoch,
			),
		).toBe(true);
		expect(
			shouldDeferPreviewActivationForVirtualScrollMeasurement(
				readVirtualScrollMeasurementEpoch(),
			),
		).toBe(false);
	});

	it("does not schedule marker cleanup work", () => {
		const requestAnimationFrame = vi.fn();
		vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

		markVirtualScrollMeasurementRun();
		markVirtualScrollMeasurementRun();

		expect(readVirtualScrollMeasurementEpoch()).toBe(2);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
	});
});
