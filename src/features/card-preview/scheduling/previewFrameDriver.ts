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
	readonly onAnimationFrameScheduled?: () => void;
	readonly onFrame: (timestamp: number) => void;
}

export function readPreviewSchedulingTime(): number {
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
	let scheduledCoordinatorLane: PreviewFrameSchedule["lane"] | null = null;
	let disposed = false;

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
					runFrame(readPreviewSchedulingTime());
				},
			);
			if (scheduled) {
				scheduledCoordinatorLane = lane;
				return;
			}
		}

		if (typeof globalThis.requestAnimationFrame === "function") {
			options.onAnimationFrameScheduled?.();
			frameHandleKind = "animation-frame";
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
			});
			return;
		}

		if (typeof globalThis.setTimeout !== "function") return;
		frameHandleKind = "timeout";
		frameHandle = globalThis.setTimeout(() => {
			frameHandle = null;
			frameHandleKind = null;
			runFrame(readPreviewSchedulingTime());
		}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
	}

	function schedule(schedule: PreviewFrameSchedule): void {
		if (disposed || isScheduled()) return;

		const delayMs = Math.max(0, schedule.delayMs ?? 0);
		if (delayMs === 0 || typeof globalThis.setTimeout !== "function") {
			scheduleFrame(schedule.lane);
			return;
		}

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

		if (
			frameHandleKind === "animation-frame" &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(frameHandle);
		} else if (typeof globalThis.clearTimeout === "function") {
			globalThis.clearTimeout(frameHandle);
		}
		frameHandle = null;
		frameHandleKind = null;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		cancel();
	}

	return { cancel, dispose, isScheduled, schedule };
}
