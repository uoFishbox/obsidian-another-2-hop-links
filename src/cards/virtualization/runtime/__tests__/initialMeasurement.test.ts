import { afterEach, describe, expect, it, vi } from "vitest";
import { createVirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import { createInitialMeasurementLifecycle } from "../measurementLifecycle";

describe("createInitialMeasurementLifecycle", () => {
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
		const frameCoordinator = createVirtualFrameCoordinator({
			getWindow: () => ownerWindow,
		});
		const lifecycle = createInitialMeasurementLifecycle({
			measurement: { hasStableScrollMetrics: false },
			hasStableVisibleRange: () => false,
			runLayoutMeasurement: vi.fn(),
			scheduleLayoutMeasurement,
			getRootEl: () => ({}) as HTMLElement,
			getWindow: () => ownerWindow,
			frameCoordinator,
		});

		lifecycle.suppressForBootstrap();
		lifecycle.scheduleObservedLayoutMeasurement();

		expect(releaseCallbacks).toHaveLength(1);
		expect(scheduleLayoutMeasurement).not.toHaveBeenCalled();

		releaseCallbacks[0]?.(0);
		lifecycle.scheduleObservedLayoutMeasurement();

		expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		expect(ownerWindow.cancelAnimationFrame).not.toHaveBeenCalled();
		lifecycle.cancel();
		frameCoordinator.dispose();
	});

	it("cancels a pending bootstrap suppression frame", () => {
		const scheduleLayoutMeasurement = vi.fn();
		const ownerWindow = {
			requestAnimationFrame: vi.fn(() => 7),
			cancelAnimationFrame: vi.fn(),
			setTimeout: vi.fn(),
			clearTimeout: vi.fn(),
		} as unknown as Window;
		const frameCoordinator = createVirtualFrameCoordinator({
			getWindow: () => ownerWindow,
		});
		const lifecycle = createInitialMeasurementLifecycle({
			measurement: { hasStableScrollMetrics: false },
			hasStableVisibleRange: () => false,
			runLayoutMeasurement: vi.fn(),
			scheduleLayoutMeasurement,
			getRootEl: () => ({}) as HTMLElement,
			getWindow: () => ownerWindow,
			frameCoordinator,
		});

		lifecycle.suppressForBootstrap();
		lifecycle.cancel();
		lifecycle.scheduleObservedLayoutMeasurement();

		expect(ownerWindow.cancelAnimationFrame).toHaveBeenCalledWith(7);
		expect(scheduleLayoutMeasurement).toHaveBeenCalledTimes(1);
		frameCoordinator.dispose();
	});

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
		const runLayoutMeasurement = vi.fn();
		const lifecycle = createInitialMeasurementLifecycle({
			measurement: { hasStableScrollMetrics: false },
			hasStableVisibleRange: () => false,
			runLayoutMeasurement,
			scheduleLayoutMeasurement: vi.fn(),
			getRootEl: () => ({}) as HTMLElement,
			getWindow: () => ownerWindow,
			frameCoordinator,
			maxPasses: 1,
		});

		lifecycle.scheduleStabilization();
		expect(frames).toHaveLength(1);

		frames[0]?.(0);
		expect(runLayoutMeasurement).not.toHaveBeenCalled();
		expect(frames).toHaveLength(2);

		frames[1]?.(1);
		expect(runLayoutMeasurement).toHaveBeenCalledOnce();
		frameCoordinator.dispose();
	});

	it("starts stabilization again after a scroll-cancelled observation is reset", () => {
		let scheduledTask: (() => void) | null = null;
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule(_lane, _key, task): boolean {
				if (scheduledTask) return false;
				scheduledTask = task;
				return true;
			},
			cancel(): void {
				scheduledTask = null;
			},
			isScheduled: () => scheduledTask !== null,
			dispose(): void {
				scheduledTask = null;
			},
		};
		const runScheduledFrame = (): void => {
			const task = scheduledTask as (() => void) | null;
			scheduledTask = null;
			task?.();
		};
		const runLayoutMeasurement = vi.fn();
		const lifecycle = createInitialMeasurementLifecycle({
			measurement: { hasStableScrollMetrics: false },
			hasStableVisibleRange: () => false,
			runLayoutMeasurement,
			scheduleLayoutMeasurement: vi.fn(),
			getRootEl: () => ({}) as HTMLElement,
			getWindow: () => ({ requestAnimationFrame: vi.fn() }) as unknown as Window,
			frameCoordinator,
			maxPasses: 1,
		});

		lifecycle.scheduleStabilization();
		lifecycle.cancelBecauseScrollStarted();
		lifecycle.resetForObservation();
		lifecycle.scheduleStabilization();
		runScheduledFrame();
		runScheduledFrame();

		expect(runLayoutMeasurement).toHaveBeenCalledOnce();
	});
});
