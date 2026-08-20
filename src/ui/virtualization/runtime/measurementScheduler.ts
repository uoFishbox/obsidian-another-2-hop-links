import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";

const MEASUREMENT_LANE = "scroll-critical" as const;
const LAYOUT_MEASUREMENT_TASK_KEY = "virtual-list:layout-measurement";
const SCROLL_MEASUREMENT_TASK_KEY = "virtual-list:scroll-measurement";
const UNSTABLE_MEASUREMENT_TASK_KEY = "virtual-list:unstable-measurement";

export interface VirtualMeasurementScheduler {
	hasPendingLayoutMeasurement(): boolean;
	scheduleLayoutMeasurement(): void;
	scheduleScrollMeasurement(task?: () => void): void;
	scheduleUnstableMeasurementRetry(): void;
	resetUnstableMeasurementRetry(): void;
	cancelAll(): void;
}

export interface CreateVirtualMeasurementSchedulerOptions {
	frameCoordinator: VirtualFrameCoordinator;
	hasSchedulingWindow(): boolean;
	runLayoutMeasurement(): void;
	runScrollMeasurement(): void;
	unstableMeasurementRetryLimit: number;
}

/**
 * Owns measurement task priority, deduplication, cancellation, and unstable
 * layout retries. Measurement computation remains owned by the runtime.
 */
export function createVirtualMeasurementScheduler({
	frameCoordinator,
	hasSchedulingWindow,
	runLayoutMeasurement,
	runScrollMeasurement,
	unstableMeasurementRetryLimit,
}: CreateVirtualMeasurementSchedulerOptions): VirtualMeasurementScheduler {
	let unstableMeasurementRetryCount = 0;
	let pendingScrollMeasurementTask: (() => void) | undefined;

	const hasPendingLayoutMeasurement = (): boolean =>
		frameCoordinator.isScheduled(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY) ||
		frameCoordinator.isScheduled(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);

	const scheduleLayoutMeasurement = (): void => {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY)
		) {
			return;
		}

		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY);
		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			LAYOUT_MEASUREMENT_TASK_KEY,
			runLayoutMeasurement,
		);
	};

	const runScheduledScrollMeasurement = (): void => {
		const task = pendingScrollMeasurementTask ?? runScrollMeasurement;
		pendingScrollMeasurementTask = undefined;
		task();
	};

	const scheduleScrollMeasurement = (task?: () => void): void => {
		if (task) {
			pendingScrollMeasurementTask = task;
		}
		if (
			!hasSchedulingWindow() ||
			hasPendingLayoutMeasurement() ||
			frameCoordinator.isScheduled(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY)
		) {
			return;
		}

		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			SCROLL_MEASUREMENT_TASK_KEY,
			runScheduledScrollMeasurement,
		);
	};

	const runUnstableMeasurementRetry = (): void => {
		unstableMeasurementRetryCount += 1;
		runLayoutMeasurement();
	};

	const scheduleUnstableMeasurementRetry = (): void => {
		if (
			!hasSchedulingWindow() ||
			frameCoordinator.isScheduled(
				MEASUREMENT_LANE,
				UNSTABLE_MEASUREMENT_TASK_KEY,
			) ||
			unstableMeasurementRetryCount >= unstableMeasurementRetryLimit
		) {
			return;
		}

		frameCoordinator.schedule(
			MEASUREMENT_LANE,
			UNSTABLE_MEASUREMENT_TASK_KEY,
			runUnstableMeasurementRetry,
		);
	};

	const resetUnstableMeasurementRetry = (): void => {
		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		unstableMeasurementRetryCount = 0;
	};

	const cancelAll = (): void => {
		frameCoordinator.cancel(MEASUREMENT_LANE, LAYOUT_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, SCROLL_MEASUREMENT_TASK_KEY);
		frameCoordinator.cancel(MEASUREMENT_LANE, UNSTABLE_MEASUREMENT_TASK_KEY);
		pendingScrollMeasurementTask = undefined;
	};

	return {
		hasPendingLayoutMeasurement,
		scheduleLayoutMeasurement,
		scheduleScrollMeasurement,
		scheduleUnstableMeasurementRetry,
		resetUnstableMeasurementRetry,
		cancelAll,
	};
}
