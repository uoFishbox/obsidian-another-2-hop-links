import type { CCLDevMeasurementName } from "infrastructure/debug/CCLDevMeasurements";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface ScheduledVirtualListTask {
	schedule: () => boolean;
	cancel: () => void;
	isScheduled: () => boolean;
}

const getDefaultWindow = (): Window | null =>
	typeof window === "undefined" ? null : window;

const resolveScheduledTaskWindow = (getWindow?: () => Window | null): Window | null =>
	getWindow?.() ?? getDefaultWindow();

export interface CreateScheduledVirtualListTaskOptions {
	getWindow?: () => Window | null;
	/** Per-task counter name. Falls back to the aggregate `virtualList.scheduler.animationFrame`. */
	counterName?: CCLDevMeasurementName;
}

export const createScheduledVirtualListTask = (
	callback: () => void,
	getWindowOrOptions?: (() => Window | null) | CreateScheduledVirtualListTaskOptions,
): ScheduledVirtualListTask => {
	const getWindow =
		typeof getWindowOrOptions === "function"
			? getWindowOrOptions
			: getWindowOrOptions?.getWindow;
	const counterName =
		typeof getWindowOrOptions === "object" && getWindowOrOptions !== null
			? getWindowOrOptions.counterName
			: undefined;
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
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement(
						counterName ?? "virtualList.scheduler.animationFrame",
					);
				}
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
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement(
					"virtualList.postPaintScheduler.animationFrame",
				);
			}
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
