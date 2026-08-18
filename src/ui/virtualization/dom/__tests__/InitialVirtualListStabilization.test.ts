import { describe, expect, it, vi } from "vitest";
import { createVirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createInitialVirtualListStabilization } from "../initialVirtualListStabilization";
import { createVirtualListMeasurementState } from "../virtualListMeasurementState";

describe("createInitialVirtualListStabilization", () => {
	it("preserves the legacy double-rAF stabilization delay", () => {
		const frames: FrameRequestCallback[] = [];
		const ownerWindow = {
			requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
				frames.push(callback);
				return frames.length;
			}),
			cancelAnimationFrame: vi.fn(),
		} as unknown as Window;
		const frameCoordinator = createVirtualFrameCoordinator({
			getWindow: () => ownerWindow,
		});
		const measurement = createVirtualListMeasurementState();
		const runLayoutMeasurement = vi.fn();
		const stabilization = createInitialVirtualListStabilization({
			measurement,
			runLayoutMeasurement,
			getRootEl: () => ({}) as HTMLElement,
			getWindow: () => ownerWindow,
			frameCoordinator,
			maxPasses: 1,
		});

		stabilization.schedule();
		expect(frames).toHaveLength(1);

		frames[0]?.(0);
		expect(runLayoutMeasurement).not.toHaveBeenCalled();
		expect(frames).toHaveLength(2);

		frames[1]?.(1);
		expect(runLayoutMeasurement).toHaveBeenCalledOnce();
		frameCoordinator.dispose();
	});
});
