import type {
	VirtualFrameCoordinator,
	VirtualFrameLane,
} from "shared/ui/scheduling/frameCoordinator";

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
	readonly coordinator: VirtualFrameCoordinator;
	readonly taskKey: string;
	/** Window used only for the delay before work is handed to the coordinator. */
	readonly getWindow?: () => Window | null;
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
 * Delays a keyed task when needed, then delegates frame semantics to the
 * surface-owned coordinator.
 */
export function createPreviewFrameDriver(
	options: CreatePreviewFrameDriverOptions,
): PreviewFrameDriver {
	let delayHandle: number | null = null;
	let delayWindow: Window | null = null;
	let scheduledLane: PreviewFrameSchedule["lane"] | null = null;
	let disposed = false;

	const resolveWindow = (): Window | null =>
		options.getWindow?.() ?? (typeof window === "undefined" ? null : window);

	function isScheduled(): boolean {
		return delayHandle !== null || scheduledLane !== null;
	}

	function scheduleOnCoordinator(lane: PreviewFrameSchedule["lane"]): void {
		if (disposed) return;
		const scheduled = options.coordinator.schedule(lane, options.taskKey, () => {
			scheduledLane = null;
			if (disposed) return;
			options.onFrame(readPreviewSchedulingTime(resolveWindow()));
		});
		if (scheduled) scheduledLane = lane;
	}

	function schedule(schedule: PreviewFrameSchedule): void {
		if (disposed || isScheduled()) return;
		const delayMs = Math.max(0, schedule.delayMs ?? 0);
		if (delayMs === 0) {
			scheduleOnCoordinator(schedule.lane);
			return;
		}

		const ownerWindow = resolveWindow();
		const onDelayElapsed = (): void => {
			delayHandle = null;
			delayWindow = null;
			scheduleOnCoordinator(schedule.lane);
		};
		delayWindow = ownerWindow;
		delayHandle = ownerWindow
			? ownerWindow.setTimeout(onDelayElapsed, delayMs)
			: (globalThis.setTimeout(onDelayElapsed, delayMs) as unknown as number);
	}

	function cancel(): void {
		if (scheduledLane !== null) {
			options.coordinator.cancel(scheduledLane, options.taskKey);
			scheduledLane = null;
		}
		if (delayHandle === null) return;
		if (delayWindow) delayWindow.clearTimeout(delayHandle);
		else globalThis.clearTimeout(delayHandle);
		delayHandle = null;
		delayWindow = null;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		cancel();
	}

	return { cancel, dispose, isScheduled, schedule };
}
