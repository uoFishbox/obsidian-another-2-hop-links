import { afterEach, describe, expect, it, vi } from "vitest";
import { createBootstrapMeasurementSuppression } from "../bootstrapMeasurementSuppression";

describe("createBootstrapMeasurementSuppression", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("suppresses observed layout measurements until the bootstrap frame releases", () => {
		const scheduleLayoutMeasurement = vi.fn();
		const releaseCallbacks: FrameRequestCallback[] = [];
		const ownerWindow = {
			requestAnimationFrame(callback: FrameRequestCallback): number {
				releaseCallbacks.push(callback);
				return releaseCallbacks.length;
			},
			cancelAnimationFrame: vi.fn(),
			setTimeout: vi.fn(),
			clearTimeout: vi.fn(),
		} as unknown as Window;
		const suppression = createBootstrapMeasurementSuppression(
			scheduleLayoutMeasurement,
			() => ownerWindow,
		);

		suppression.suppressForBootstrap();
		suppression.scheduleObservedLayoutMeasurement();

		expect(releaseCallbacks).toHaveLength(1);
		expect(scheduleLayoutMeasurement).not.toHaveBeenCalled();

		releaseCallbacks[0]?.(0);
		suppression.scheduleObservedLayoutMeasurement();

		expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		expect(ownerWindow.cancelAnimationFrame).not.toHaveBeenCalled();
	});

	it("cancels a pending bootstrap suppression frame", () => {
		const scheduleLayoutMeasurement = vi.fn();
		const ownerWindow = {
			requestAnimationFrame: vi.fn(() => 7),
			cancelAnimationFrame: vi.fn(),
			setTimeout: vi.fn(),
			clearTimeout: vi.fn(),
		} as unknown as Window;
		const suppression = createBootstrapMeasurementSuppression(
			scheduleLayoutMeasurement,
			() => ownerWindow,
		);

		suppression.suppressForBootstrap();
		suppression.cancel();
		suppression.scheduleObservedLayoutMeasurement();

		expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(7);
		expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
	});
});
