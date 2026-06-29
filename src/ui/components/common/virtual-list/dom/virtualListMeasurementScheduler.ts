import {
	createScheduledVirtualListTask,
	type ScheduledVirtualListTask,
} from "./virtualListScheduler";

export interface VirtualListMeasurementSchedulerOptions {
	runLayoutMeasurement: () => void;
	runScrollMeasurement: () => void;
	maxUnstableMeasurementRetries: number;
	getWindow?: () => Window | null;
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
}: VirtualListMeasurementSchedulerOptions): VirtualListMeasurementScheduler => {
	let unstableMeasurementRetryCount = 0;
	const layoutTask: ScheduledVirtualListTask = createScheduledVirtualListTask(
		runLayoutMeasurement,
		getWindow,
	);
	// Frame-align scroll measurements so wheel/scroll bursts coalesce before work runs.
	const scrollTask: ScheduledVirtualListTask = createScheduledVirtualListTask(
		runScrollMeasurement,
		getWindow,
	);
	const retryTask: ScheduledVirtualListTask = createScheduledVirtualListTask(() => {
		unstableMeasurementRetryCount += 1;
		runLayoutMeasurement();
	}, getWindow);

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
