import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "ui/virtualization/scheduling/frameCoordinator";

const FALLBACK_FRAME_INTERVAL_MS = 1000 / 60;

export interface PreviewFrameDriver {
	cancel(): void;
	dispose(): void;
	isScheduled(): boolean;
	schedule(schedule: PreviewFrameSchedule): void;
}

export interface PreviewFrameSchedule {
	readonly lane: Extract<VirtualFrameLane, "idle" | "post-paint">;
	readonly delayMs?: number;
}

export interface CreatePreviewFrameDriverOptions {
	readonly coordinator?: VirtualFrameCoordinator;
	readonly taskKey: string;
	/** Window used only when no virtual frame coordinator accepts the task. */
	readonly getWindow?: () => Window | null;
	readonly onAnimationFrameScheduled?: () => void;
	readonly onFrame: (timestamp: number) => void;
}

export function readPreviewSchedulingTime(ownerWindow?: Window | null): number {
	if (typeof ownerWindow?.performance?.now === "function") {
		return ownerWindow.performance.now();
	}
	if (typeof globalThis.performance?.now === "function") {
		return globalThis.performance.now();
	}
	return Date.now();
}

/**
 * Creates a single-task frame driver backed by a virtual surface coordinator,
 * requestAnimationFrame, or a timeout fallback.
 */
export function createPreviewFrameDriver(
	options: CreatePreviewFrameDriverOptions,
): PreviewFrameDriver {
	let frameHandle: number | null = null;
	let frameHandleKind: "animation-frame" | "timeout" | null = null;
	let frameHandleWindow: Window | null = null;
	let scheduledCoordinatorLane: PreviewFrameSchedule["lane"] | null = null;
	let disposed = false;

	const resolveWindow = (): Window | null =>
		options.getWindow?.() ?? (typeof window === "undefined" ? null : window);

	function isScheduled(): boolean {
		return scheduledCoordinatorLane !== null || frameHandle !== null;
	}

	function runFrame(timestamp: number): void {
		if (disposed) return;
		options.onFrame(timestamp);
	}

	function scheduleFrame(lane: PreviewFrameSchedule["lane"]): void {
		if (options.coordinator) {
			const scheduled = options.coordinator.schedule(
				lane,
				options.taskKey,
				() => {
					scheduledCoordinatorLane = null;
					runFrame(readPreviewSchedulingTime(resolveWindow()));
				},
			);
			if (scheduled) {
				scheduledCoordinatorLane = lane;
				return;
			}
		}

		const ownerWindow = resolveWindow();
		if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
			options.onAnimationFrameScheduled?.();
			frameHandleKind = "animation-frame";
			frameHandleWindow = ownerWindow;
			frameHandle = ownerWindow.requestAnimationFrame((timestamp) => {
				frameHandle = null;
				frameHandleKind = null;
				frameHandleWindow = null;
				if (lane === "post-paint") {
					frameHandleKind = "timeout";
					frameHandle = ownerWindow.setTimeout(() => {
						frameHandle = null;
						frameHandleKind = null;
						frameHandleWindow = null;
						runFrame(timestamp);
					}, 0);
					return;
				}
				runFrame(timestamp);
			});
			return;
		}

		if (ownerWindow && typeof ownerWindow.setTimeout === "function") {
			frameHandleKind = "timeout";
			frameHandleWindow = ownerWindow;
			frameHandle = ownerWindow.setTimeout(() => {
				frameHandle = null;
				frameHandleKind = null;
				frameHandleWindow = null;
				runFrame(readPreviewSchedulingTime(ownerWindow));
			}, FALLBACK_FRAME_INTERVAL_MS);
			return;
		}

		scheduleFrameOnGlobalThis(lane);
	}

	function scheduleFrameOnGlobalThis(lane: PreviewFrameSchedule["lane"]): void {
		// Windowless realms (node tests) resolve no DOM window. Keep the
		// globalThis fallback so the driver still schedules there instead of
		// silently dropping the task.
		if (typeof globalThis.requestAnimationFrame === "function") {
			options.onAnimationFrameScheduled?.();
			frameHandleKind = "animation-frame";
			frameHandleWindow = null;
			frameHandle = globalThis.requestAnimationFrame((timestamp) => {
				frameHandle = null;
				frameHandleKind = null;
				if (
					lane === "post-paint" &&
					typeof globalThis.setTimeout === "function"
				) {
					frameHandleKind = "timeout";
					frameHandle = globalThis.setTimeout(() => {
						frameHandle = null;
						frameHandleKind = null;
						runFrame(timestamp);
					}, 0) as unknown as number;
					return;
				}
				runFrame(timestamp);
			}) as unknown as number;
			return;
		}

		if (typeof globalThis.setTimeout !== "function") return;
		frameHandleKind = "timeout";
		frameHandle = globalThis.setTimeout(() => {
			frameHandle = null;
			frameHandleKind = null;
			runFrame(readPreviewSchedulingTime(null));
		}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
	}

	function schedule(schedule: PreviewFrameSchedule): void {
		if (disposed || isScheduled()) return;

		const delayMs = Math.max(0, schedule.delayMs ?? 0);
		if (delayMs === 0) {
			scheduleFrame(schedule.lane);
			return;
		}

		const ownerWindow = resolveWindow();
		if (ownerWindow) {
			frameHandleKind = "timeout";
			frameHandleWindow = ownerWindow;
			frameHandle = ownerWindow.setTimeout(() => {
				frameHandle = null;
				frameHandleKind = null;
				frameHandleWindow = null;
				scheduleFrame(schedule.lane);
			}, delayMs);
			return;
		}

		if (typeof globalThis.setTimeout !== "function") return;
		frameHandleKind = "timeout";
		frameHandle = globalThis.setTimeout(() => {
			frameHandle = null;
			frameHandleKind = null;
			scheduleFrame(schedule.lane);
		}, delayMs) as unknown as number;
	}

	function cancel(): void {
		if (scheduledCoordinatorLane && options.coordinator) {
			options.coordinator.cancel(scheduledCoordinatorLane, options.taskKey);
			scheduledCoordinatorLane = null;
		}
		if (frameHandle === null) return;

		if (frameHandleKind === "animation-frame") {
			if (
				frameHandleWindow &&
				typeof frameHandleWindow.cancelAnimationFrame === "function"
			) {
				frameHandleWindow.cancelAnimationFrame(frameHandle);
			} else if (typeof globalThis.cancelAnimationFrame === "function") {
				globalThis.cancelAnimationFrame(frameHandle);
			}
		} else if (frameHandleWindow) {
			frameHandleWindow.clearTimeout(frameHandle);
		} else if (typeof globalThis.clearTimeout === "function") {
			globalThis.clearTimeout(frameHandle);
		}
		frameHandle = null;
		frameHandleKind = null;
		frameHandleWindow = null;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		cancel();
	}

	return { cancel, dispose, isScheduled, schedule };
}
