interface VirtualListMeasurementSchedulerOptions {
	runLayoutMeasurement: () => void;
	runScrollMeasurement: () => void;
	maxUnstableMeasurementRetries: number;
	getWindow?: () => Window | null;
}

export interface ScheduledVirtualListTask {
	schedule: () => boolean;
	cancel: () => void;
	isScheduled: () => boolean;
}

const getDefaultWindow = (): Window | null =>
	typeof window === "undefined" ? null : window;

const resolveScheduledTaskWindow = (getWindow?: () => Window | null): Window | null =>
	getWindow?.() ?? getDefaultWindow();

export const createScheduledVirtualListTask = (
	callback: () => void,
	getWindow?: () => Window | null,
): ScheduledVirtualListTask => {
	let scheduled = false;
	let handle = 0;
	let usesAnimationFrame = false;

	// Stable fire handler: avoids allocating a new closure on every schedule().
	// `callback` is fixed at task creation, so a single shared handler is safe.
	const fire = (): void => {
		handle = 0;
		scheduled = false;
		callback();
	};

	return {
		schedule() {
			const ownerWindow = resolveScheduledTaskWindow(getWindow);
			if (!ownerWindow || scheduled) {
				return false;
			}

			scheduled = true;

			if (typeof ownerWindow.requestAnimationFrame === "function") {
				usesAnimationFrame = true;
				handle = ownerWindow.requestAnimationFrame(fire);
				return true;
			}

			usesAnimationFrame = false;
			handle = ownerWindow.setTimeout(fire, 0);
			return true;
		},
		cancel() {
			if (!scheduled) {
				return;
			}

			const ownerWindow = resolveScheduledTaskWindow(getWindow);
			if (!ownerWindow) {
				scheduled = false;
				handle = 0;
				return;
			}

			if (usesAnimationFrame) {
				ownerWindow.cancelAnimationFrame(handle);
			} else {
				ownerWindow.clearTimeout(handle);
			}

			scheduled = false;
			handle = 0;
		},
		isScheduled: () => scheduled,
	};
};

export const createPostPaintVirtualListTask = (
	callback: () => void,
	frameDelay = 2,
	getWindow?: () => Window | null,
): ScheduledVirtualListTask => {
	let scheduled = false;
	let handle: number | null = null;
	let cancelled = false;

	const cancelFrame = () => {
		if (handle !== null) {
			const ownerWindow = resolveScheduledTaskWindow(getWindow);
			if (ownerWindow) {
				if (typeof ownerWindow.cancelAnimationFrame === "function") {
					ownerWindow.cancelAnimationFrame(handle);
				} else {
					ownerWindow.clearTimeout(handle);
				}
			}
		}
		handle = null;
	};

	const scheduleFrame = (remainingFrames: number) => {
		const ownerWindow = resolveScheduledTaskWindow(getWindow);
		if (!ownerWindow) {
			scheduled = false;
			handle = null;
			return;
		}

		if (typeof ownerWindow.requestAnimationFrame === "function") {
			handle = ownerWindow.requestAnimationFrame(() => {
				handle = null;

				if (cancelled) {
					return;
				}

				if (remainingFrames <= 1) {
					scheduled = false;
					callback();
					return;
				}

				scheduleFrame(remainingFrames - 1);
			});
			return;
		}

		handle = ownerWindow.setTimeout(() => {
			handle = null;
			if (!cancelled) {
				scheduled = false;
				callback();
			}
		}, 0);
	};

	return {
		schedule() {
			const ownerWindow = resolveScheduledTaskWindow(getWindow);
			if (!ownerWindow || scheduled) {
				return false;
			}

			scheduled = true;
			cancelled = false;
			scheduleFrame(Math.max(1, frameDelay));
			return true;
		},
		cancel() {
			if (!scheduled) {
				return;
			}

			cancelled = true;
			cancelFrame();
			scheduled = false;
		},
		isScheduled: () => scheduled,
	};
};

export const createVirtualListMeasurementScheduler = ({
	runLayoutMeasurement,
	runScrollMeasurement,
	maxUnstableMeasurementRetries,
	getWindow,
}: VirtualListMeasurementSchedulerOptions) => {
	let unstableMeasurementRetryCount = 0;
	const layoutTask = createScheduledVirtualListTask(runLayoutMeasurement, getWindow);
	// Frame-align scroll measurements so wheel/scroll bursts coalesce before work runs.
	const scrollTask = createScheduledVirtualListTask(runScrollMeasurement, getWindow);
	const retryTask = createScheduledVirtualListTask(() => {
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
