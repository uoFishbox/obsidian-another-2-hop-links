import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "ui/virtualization/scheduling/scrollActivity";

export type VirtualFrameLane = "scroll-critical" | "post-paint" | "idle";

export interface VirtualFrameCoordinator {
	schedule(lane: VirtualFrameLane, key: string, task: () => void): boolean;
	cancel(lane: VirtualFrameLane, key: string): void;
	isScheduled(lane: VirtualFrameLane, key: string): boolean;
	dispose(): void;
}

export interface CoordinatedScheduledTask {
	schedule(): boolean;
	cancel(): void;
	isScheduled(): boolean;
}

const CRITICAL_BUDGET_MS = 2;
const POST_PAINT_BUDGET_MS = 2;
const IDLE_BUDGET_MS = 2;

/** Creates one scheduler boundary for all work owned by a virtual surface. */
export function createVirtualFrameCoordinator(
	params: {
		readonly getWindow?: () => Window | null;
	} = {},
): VirtualFrameCoordinator {
	const queues: Record<VirtualFrameLane, Map<string, () => void>> = {
		"scroll-critical": new Map(),
		"post-paint": new Map(),
		idle: new Map(),
	};
	let criticalHandle: number | null = null;
	let criticalUsesAnimationFrame = false;
	let postPaintFrameHandle: number | null = null;
	let postPaintUsesAnimationFrame = false;
	let postPaintTaskHandle: number | null = null;
	let idleHandle: number | null = null;
	let idleUsesCallback = false;
	let disposed = false;
	const scheduledKeysScratch: string[] = [];
	const scheduledTasksScratch: Array<() => void> = [];
	const collectScheduledTask = (task: () => void, key: string): void => {
		scheduledKeysScratch.push(key);
		scheduledTasksScratch.push(task);
	};

	const resolveWindow = (): Window | null =>
		params.getWindow?.() ?? (typeof window === "undefined" ? null : window);
	const readNow = (): number =>
		typeof globalThis.performance?.now === "function"
			? globalThis.performance.now()
			: Date.now();

	function runLane(lane: VirtualFrameLane, budgetMs: number, maxTasks: number): void {
		const queue = queues[lane];
		queue.forEach(collectScheduledTask);
		const deadline = readNow() + budgetMs;
		let executed = 0;
		try {
			for (let index = 0; index < scheduledKeysScratch.length; index += 1) {
				if (executed >= maxTasks || readNow() > deadline) break;
				const key = scheduledKeysScratch[index];
				const task = scheduledTasksScratch[index];
				if (queue.get(key) !== task) continue;
				queue.delete(key);
				task();
				executed += 1;
			}
		} finally {
			scheduledKeysScratch.length = 0;
			scheduledTasksScratch.length = 0;
		}
		if (process.env.NODE_ENV !== "production" && executed > 0) {
			recordCCLDevMeasurement(
				lane === "scroll-critical"
					? "virtualFrame.critical"
					: lane === "post-paint"
						? "virtualFrame.postPaint"
						: "virtualFrame.idle",
			);
		}
	}

	function scheduleCriticalDrain(): void {
		if (disposed || criticalHandle !== null) return;
		const ownerWindow = resolveWindow();
		if (!ownerWindow) return;
		const drain = (): void => {
			criticalHandle = null;
			runLane("scroll-critical", CRITICAL_BUDGET_MS, Number.POSITIVE_INFINITY);
			if (queues["scroll-critical"].size > 0) scheduleCriticalDrain();
		};
		if (typeof ownerWindow.requestAnimationFrame === "function") {
			criticalUsesAnimationFrame = true;
			criticalHandle = ownerWindow.requestAnimationFrame(drain);
			return;
		}
		criticalUsesAnimationFrame = false;
		criticalHandle = ownerWindow.setTimeout(drain, 0);
	}

	function schedulePostPaintDrain(): void {
		if (disposed || postPaintFrameHandle !== null || postPaintTaskHandle !== null) {
			return;
		}
		const ownerWindow = resolveWindow();
		if (!ownerWindow) return;
		const afterFrame = (): void => {
			postPaintFrameHandle = null;
			postPaintTaskHandle = ownerWindow.setTimeout(() => {
				postPaintTaskHandle = null;
				runLane("post-paint", POST_PAINT_BUDGET_MS, 1);
				if (queues["post-paint"].size > 0) schedulePostPaintDrain();
			}, 0);
		};
		if (typeof ownerWindow.requestAnimationFrame === "function") {
			postPaintUsesAnimationFrame = true;
			postPaintFrameHandle = ownerWindow.requestAnimationFrame(afterFrame);
			return;
		}
		postPaintUsesAnimationFrame = false;
		postPaintFrameHandle = ownerWindow.setTimeout(afterFrame, 0);
	}

	function scheduleIdleDrain(): void {
		if (
			disposed ||
			idleHandle !== null ||
			queues.idle.size === 0 ||
			isScrollActivityActive()
		) {
			return;
		}
		const ownerWindow = resolveWindow();
		if (!ownerWindow) return;
		const drain = (): void => {
			idleHandle = null;
			if (isScrollActivityActive()) return;
			runLane("idle", IDLE_BUDGET_MS, 1);
			if (queues.idle.size > 0) scheduleIdleDrain();
		};
		if (typeof ownerWindow.requestIdleCallback === "function") {
			idleUsesCallback = true;
			idleHandle = ownerWindow.requestIdleCallback(drain, { timeout: 50 });
			return;
		}
		idleUsesCallback = false;
		idleHandle = ownerWindow.setTimeout(drain, 0);
	}

	function cancelIdleDrain(): void {
		if (idleHandle === null) return;
		const ownerWindow = resolveWindow();
		if (ownerWindow) {
			if (
				idleUsesCallback &&
				typeof ownerWindow.cancelIdleCallback === "function"
			) {
				ownerWindow.cancelIdleCallback(idleHandle);
			} else {
				ownerWindow.clearTimeout(idleHandle);
			}
		}
		idleHandle = null;
	}

	const unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		if (isActive) {
			cancelIdleDrain();
			return;
		}
		scheduleIdleDrain();
	});

	function cancelAllHandles(): void {
		const ownerWindow = resolveWindow();
		if (ownerWindow && criticalHandle !== null) {
			if (
				criticalUsesAnimationFrame &&
				typeof ownerWindow.cancelAnimationFrame === "function"
			) {
				ownerWindow.cancelAnimationFrame(criticalHandle);
			} else {
				ownerWindow.clearTimeout(criticalHandle);
			}
		}
		if (ownerWindow && postPaintFrameHandle !== null) {
			if (
				postPaintUsesAnimationFrame &&
				typeof ownerWindow.cancelAnimationFrame === "function"
			) {
				ownerWindow.cancelAnimationFrame(postPaintFrameHandle);
			} else {
				ownerWindow.clearTimeout(postPaintFrameHandle);
			}
		}
		if (ownerWindow && postPaintTaskHandle !== null) {
			ownerWindow.clearTimeout(postPaintTaskHandle);
		}
		criticalHandle = null;
		postPaintFrameHandle = null;
		postPaintTaskHandle = null;
		cancelIdleDrain();
	}

	return {
		schedule(lane, key, task): boolean {
			if (disposed || queues[lane].has(key)) return false;
			queues[lane].set(key, task);
			if (lane === "scroll-critical") scheduleCriticalDrain();
			else if (lane === "post-paint") schedulePostPaintDrain();
			else scheduleIdleDrain();
			return true;
		},
		cancel(lane, key): void {
			queues[lane].delete(key);
		},
		isScheduled: (lane, key) => queues[lane].has(key),
		dispose(): void {
			if (disposed) return;
			disposed = true;
			cancelAllHandles();
			for (const queue of Object.values(queues)) queue.clear();
			unsubscribeScrollActivity();
		},
	};
}

/** Adapts one coordinator lane/key to the existing scheduled-task contract. */
export function createCoordinatedScheduledTask(params: {
	readonly coordinator: VirtualFrameCoordinator;
	readonly lane: VirtualFrameLane;
	readonly key: string;
	readonly task: () => void;
}): CoordinatedScheduledTask {
	return {
		schedule: () =>
			params.coordinator.schedule(params.lane, params.key, params.task),
		cancel: () => params.coordinator.cancel(params.lane, params.key),
		isScheduled: () => params.coordinator.isScheduled(params.lane, params.key),
	};
}
