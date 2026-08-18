import {
	createCoordinatedScheduledTask,
	type VirtualFrameCoordinator,
} from "ui/virtualization/scheduling/frameCoordinator";

export interface VirtualListMeasurementSchedulerOptions {
	runLayoutMeasurement: () => void;
	runScrollMeasurement: () => void;
	maxUnstableMeasurementRetries: number;
	getWindow?: () => Window | null;
	frameCoordinator: VirtualFrameCoordinator;
}

export interface VirtualListMeasurementScheduler {
	hasPendingLayoutMeasurement(): boolean;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(task?: () => void): void;
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
	let pendingScrollMeasurementTask: (() => void) | undefined;
	const layoutTask = createCoordinatedScheduledTask({
		coordinator: frameCoordinator,
		lane: "scroll-critical",
		key: "virtual-list:layout-measurement",
		task: runLayoutMeasurement,
	});
	const scrollTask = createCoordinatedScheduledTask({
		coordinator: frameCoordinator,
		lane: "scroll-critical",
		key: "virtual-list:scroll-measurement",
		task: () => {
			const task = pendingScrollMeasurementTask ?? runScrollMeasurement;
			pendingScrollMeasurementTask = undefined;
			task();
		},
	});
	const retryTask = createCoordinatedScheduledTask({
		coordinator: frameCoordinator,
		lane: "scroll-critical",
		key: "virtual-list:unstable-measurement",
		task: () => {
			unstableMeasurementRetryCount += 1;
			runLayoutMeasurement();
		},
	});

	return {
		hasPendingLayoutMeasurement() {
			return layoutTask.isScheduled() || retryTask.isScheduled();
		},
		scheduleLayoutMeasurement() {
			if (!resolveScheduledTaskWindow(getWindow) || layoutTask.isScheduled())
				return;
			retryTask.cancel();
			scrollTask.cancel();
			layoutTask.schedule();
		},
		scheduleScrollMeasurement(task) {
			if (task) {
				pendingScrollMeasurementTask = task;
			}
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
			if (
				!resolveScheduledTaskWindow(getWindow) ||
				retryTask.isScheduled() ||
				unstableMeasurementRetryCount >= maxUnstableMeasurementRetries
			) {
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
			pendingScrollMeasurementTask = undefined;
		},
	};
};
