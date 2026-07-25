import type { CCLDevMeasurementName } from "infrastructure/debug/CCLDevMeasurements";
import {
	createScheduledVirtualListTask,
	type ScheduledVirtualListTask,
} from "./virtualListScheduler";
import {
	createCoordinatedScheduledTask,
	type VirtualFrameCoordinator,
} from "ui/virtualization/scheduling/frameCoordinator";

export interface VirtualListMeasurementSchedulerOptions {
	runLayoutMeasurement: () => void;
	runScrollMeasurement: () => void;
	maxUnstableMeasurementRetries: number;
	getWindow?: () => Window | null;
	frameCoordinator?: VirtualFrameCoordinator;
}

export interface VirtualListMeasurementScheduler {
	hasPendingLayoutMeasurement(): boolean;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(): void;
	scheduleUnstableMeasurementRetry(): void;
	resetUnstableMeasurementRetry(): void;
	cancelAll(): void;
}

const getDefaultWindow = (): Window | null =>
	typeof window === "undefined" ? null : window;

const resolveScheduledTaskWindow = (getWindow?: () => Window | null): Window | null =>
	getWindow?.() ?? getDefaultWindow();

export const createVirtualListMeasurementScheduler = ({
	runLayoutMeasurement,
	runScrollMeasurement,
	maxUnstableMeasurementRetries,
	getWindow,
	frameCoordinator,
}: VirtualListMeasurementSchedulerOptions): VirtualListMeasurementScheduler => {
	let unstableMeasurementRetryCount = 0;
	const createTask = (
		key: string,
		task: () => void,
		counterName?: CCLDevMeasurementName,
	): ScheduledVirtualListTask =>
		frameCoordinator
			? createCoordinatedScheduledTask({
					coordinator: frameCoordinator,
					lane: "scroll-critical",
					key,
					task,
				})
			: createScheduledVirtualListTask(task, { getWindow, counterName });
	const layoutTask = createTask(
		"virtual-list:layout-measurement",
		runLayoutMeasurement,
		"virtualList.scheduler.measurementLayout.animationFrame",
	);
	// Frame-align scroll measurements so wheel/scroll bursts coalesce before work runs.
	const scrollTask = createTask(
		"virtual-list:scroll-measurement",
		runScrollMeasurement,
		"virtualList.scheduler.measurementScroll.animationFrame",
	);
	const retryTask = createTask(
		"virtual-list:unstable-measurement",
		() => {
			unstableMeasurementRetryCount += 1;
			runLayoutMeasurement();
		},
		"virtualList.scheduler.unstableRetry.animationFrame",
	);

	return {
		hasPendingLayoutMeasurement() {
			return layoutTask.isScheduled() || retryTask.isScheduled();
		},
		scheduleLayoutMeasurement() {
			if (!resolveScheduledTaskWindow(getWindow) || layoutTask.isScheduled()) {
				return;
			}

			retryTask.cancel();
			scrollTask.cancel();
			layoutTask.schedule();
		},
		scheduleScrollMeasurement() {
			if (
				!resolveScheduledTaskWindow(getWindow) ||
				layoutTask.isScheduled() ||
				retryTask.isScheduled() ||
				scrollTask.isScheduled()
			) {
				return;
			}

			scrollTask.schedule();
		},
		scheduleUnstableMeasurementRetry() {
			if (!resolveScheduledTaskWindow(getWindow) || retryTask.isScheduled()) {
				return;
			}

			if (unstableMeasurementRetryCount >= maxUnstableMeasurementRetries) {
				return;
			}

			retryTask.schedule();
		},
		resetUnstableMeasurementRetry() {
			retryTask.cancel();
			unstableMeasurementRetryCount = 0;
		},
		cancelAll() {
			layoutTask.cancel();
			scrollTask.cancel();
			retryTask.cancel();
		},
	};
};
