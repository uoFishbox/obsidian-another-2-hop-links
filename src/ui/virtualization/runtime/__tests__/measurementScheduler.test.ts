import { describe, expect, it, vi } from "vitest";
import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import { createVirtualMeasurementScheduler } from "../measurementScheduler";

describe("createVirtualMeasurementScheduler", () => {
	it("restores unstable retry capacity for each observation", () => {
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
		const runScheduledTask = (): void => {
			const task = scheduledTask as (() => void) | null;
			scheduledTask = null;
			task?.();
		};
		const runLayoutMeasurement = vi.fn();
		const scheduler = createVirtualMeasurementScheduler({
			frameCoordinator,
			hasSchedulingWindow: () => true,
			runLayoutMeasurement,
			runScrollMeasurement: vi.fn(),
			unstableMeasurementRetryLimit: 1,
		});

		scheduler.scheduleUnstableMeasurementRetry();
		runScheduledTask();
		scheduler.scheduleUnstableMeasurementRetry();
		expect(scheduledTask).toBeNull();

		scheduler.resetForObservation();
		scheduler.scheduleUnstableMeasurementRetry();
		runScheduledTask();

		expect(runLayoutMeasurement).toHaveBeenCalledTimes(2);
	});
});
