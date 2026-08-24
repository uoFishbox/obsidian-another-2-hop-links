import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "shared/ui/scroll/scrollActivity";

export type VirtualFrameLane =
	| "animation-frame"
	| "scroll-critical"
	| "post-paint"
	| "idle";

export interface VirtualFrameCoordinator {
	schedule(lane: VirtualFrameLane, key: string, task: () => void): boolean;
	cancel(lane: VirtualFrameLane, key: string): void;
	isScheduled(lane: VirtualFrameLane, key: string): boolean;
	/**
	 * Binds this surface scheduler to its actual DOM realm. The implementation
	 * follows Obsidian's onWindowMigrated hook so popout moves rebind queued work.
	 * Optional to keep lightweight test doubles/source-compatible consumers valid.
	 */
	bindOwnerElement?(element: HTMLElement | null): void;
	dispose(): void;
}

const CRITICAL_BUDGET_MS = 2;
const POST_PAINT_BUDGET_MS = 2;
const IDLE_BUDGET_MS = 2;
const IDLE_CALLBACK_TIMEOUT_MS = 50;

/** Creates one scheduler boundary for all work owned by a virtual surface. */
export function createVirtualFrameCoordinator(
	params: {
		readonly getWindow?: () => Window | null;
	} = {},
): VirtualFrameCoordinator {
	const queues: Record<VirtualFrameLane, Map<string, () => void>> = {
		"animation-frame": new Map(),
		"scroll-critical": new Map(),
		"post-paint": new Map(),
		idle: new Map(),
	};
	let boundOwnerWindow: Window | null = null;
	let boundOwnerElement: HTMLElement | null = null;
	let unregisterWindowMigration: (() => void) | null = null;

	let animationFrameHandle: number | null = null;
	let animationFrameHandleWindow: Window | null = null;
	let animationFrameUsesAnimationFrame = false;
	let criticalHandle: number | null = null;
	let criticalHandleWindow: Window | null = null;
	let criticalUsesAnimationFrame = false;
	let postPaintFrameHandle: number | null = null;
	let postPaintFrameWindow: Window | null = null;
	let postPaintUsesAnimationFrame = false;
	let postPaintTaskHandle: number | null = null;
	let postPaintTaskWindow: Window | null = null;
	let idleHandle: number | null = null;
	let idleHandleWindow: Window | null = null;
	let idleWatchdogHandle: number | null = null;
	let idleWatchdogWindow: Window | null = null;
	let idleUsesCallback = false;
	let disposed = false;
	const scheduledKeysScratch: string[] = [];
	const scheduledTasksScratch: Array<() => void> = [];
	const collectScheduledTask = (task: () => void, key: string): void => {
		scheduledKeysScratch.push(key);
		scheduledTasksScratch.push(task);
	};

	const resolveWindow = (): Window | null =>
		boundOwnerWindow ??
		params.getWindow?.() ??
		(typeof window === "undefined" ? null : window);
	const readNow = (): number => {
		const ownerWindow = resolveWindow();
		return typeof ownerWindow?.performance?.now === "function"
			? ownerWindow.performance.now()
			: typeof globalThis.performance?.now === "function"
				? globalThis.performance.now()
				: Date.now();
	};

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
	}

	function scheduleAnimationFrameDrain(): void {
		if (disposed || animationFrameHandle !== null) return;
		const ownerWindow = resolveWindow();
		if (!ownerWindow) return;
		const drain = (): void => {
			animationFrameHandle = null;
			animationFrameHandleWindow = null;
			runLane(
				"animation-frame",
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
			);
			if (queues["animation-frame"].size > 0) scheduleAnimationFrameDrain();
		};
		animationFrameHandleWindow = ownerWindow;
		if (typeof ownerWindow.requestAnimationFrame === "function") {
			animationFrameUsesAnimationFrame = true;
			animationFrameHandle = ownerWindow.requestAnimationFrame(drain);
			return;
		}
		animationFrameUsesAnimationFrame = false;
		animationFrameHandle = ownerWindow.setTimeout(drain, 0);
	}

	function scheduleCriticalDrain(): void {
		if (disposed || criticalHandle !== null) return;
		const ownerWindow = resolveWindow();
		if (!ownerWindow) return;
		const drain = (): void => {
			criticalHandle = null;
			criticalHandleWindow = null;
			runLane("scroll-critical", CRITICAL_BUDGET_MS, Number.POSITIVE_INFINITY);
			if (queues["scroll-critical"].size > 0) scheduleCriticalDrain();
		};
		criticalHandleWindow = ownerWindow;
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
			postPaintFrameWindow = null;
			postPaintTaskWindow = ownerWindow;
			postPaintTaskHandle = ownerWindow.setTimeout(() => {
				postPaintTaskHandle = null;
				postPaintTaskWindow = null;
				runLane("post-paint", POST_PAINT_BUDGET_MS, 1);
				if (queues["post-paint"].size > 0) schedulePostPaintDrain();
			}, 0);
		};
		postPaintFrameWindow = ownerWindow;
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
		const runIdleTasks = (): void => {
			if (isScrollActivityActive()) return;
			runLane("idle", IDLE_BUDGET_MS, 1);
			if (queues.idle.size > 0) scheduleIdleDrain();
		};
		idleHandleWindow = ownerWindow;
		if (typeof ownerWindow.requestIdleCallback === "function") {
			idleUsesCallback = true;
			let requestHandle: number | undefined;
			const drainFromIdleCallback = (): void => {
				if (requestHandle === undefined || idleHandle !== requestHandle) return;
				idleHandle = null;
				idleHandleWindow = null;
				if (idleWatchdogHandle !== null) {
					idleWatchdogWindow?.clearTimeout(idleWatchdogHandle);
					idleWatchdogHandle = null;
					idleWatchdogWindow = null;
				}
				runIdleTasks();
			};
			requestHandle = ownerWindow.requestIdleCallback(drainFromIdleCallback, {
				timeout: IDLE_CALLBACK_TIMEOUT_MS,
			});
			idleHandle = requestHandle;
			const watchdogHandle = ownerWindow.setTimeout(() => {
				if (
					idleWatchdogHandle !== watchdogHandle ||
					idleHandle !== requestHandle
				) {
					return;
				}
				idleWatchdogHandle = null;
				idleWatchdogWindow = null;
				ownerWindow.cancelIdleCallback(requestHandle);
				idleHandle = null;
				idleHandleWindow = null;
				runIdleTasks();
			}, IDLE_CALLBACK_TIMEOUT_MS);
			idleWatchdogHandle = watchdogHandle;
			idleWatchdogWindow = ownerWindow;
			return;
		}
		idleUsesCallback = false;
		idleHandle = ownerWindow.setTimeout(() => {
			idleHandle = null;
			idleHandleWindow = null;
			runIdleTasks();
		}, 0);
	}

	function cancelIdleDrain(): void {
		if (idleHandle !== null && idleHandleWindow) {
			if (
				idleUsesCallback &&
				typeof idleHandleWindow.cancelIdleCallback === "function"
			) {
				idleHandleWindow.cancelIdleCallback(idleHandle);
			} else {
				idleHandleWindow.clearTimeout(idleHandle);
			}
		}
		if (idleWatchdogHandle !== null && idleWatchdogWindow) {
			idleWatchdogWindow.clearTimeout(idleWatchdogHandle);
		}
		idleHandle = null;
		idleHandleWindow = null;
		idleWatchdogHandle = null;
		idleWatchdogWindow = null;
	}

	const unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		if (isActive) {
			cancelIdleDrain();
			return;
		}
		scheduleIdleDrain();
	});

	function cancelAllHandles(): void {
		if (animationFrameHandle !== null && animationFrameHandleWindow) {
			if (
				animationFrameUsesAnimationFrame &&
				typeof animationFrameHandleWindow.cancelAnimationFrame === "function"
			) {
				animationFrameHandleWindow.cancelAnimationFrame(animationFrameHandle);
			} else {
				animationFrameHandleWindow.clearTimeout(animationFrameHandle);
			}
		}
		if (criticalHandle !== null && criticalHandleWindow) {
			if (
				criticalUsesAnimationFrame &&
				typeof criticalHandleWindow.cancelAnimationFrame === "function"
			) {
				criticalHandleWindow.cancelAnimationFrame(criticalHandle);
			} else {
				criticalHandleWindow.clearTimeout(criticalHandle);
			}
		}
		if (postPaintFrameHandle !== null && postPaintFrameWindow) {
			if (
				postPaintUsesAnimationFrame &&
				typeof postPaintFrameWindow.cancelAnimationFrame === "function"
			) {
				postPaintFrameWindow.cancelAnimationFrame(postPaintFrameHandle);
			} else {
				postPaintFrameWindow.clearTimeout(postPaintFrameHandle);
			}
		}
		if (postPaintTaskHandle !== null && postPaintTaskWindow) {
			postPaintTaskWindow.clearTimeout(postPaintTaskHandle);
		}
		animationFrameHandle = null;
		animationFrameHandleWindow = null;
		criticalHandle = null;
		criticalHandleWindow = null;
		postPaintFrameHandle = null;
		postPaintFrameWindow = null;
		postPaintTaskHandle = null;
		postPaintTaskWindow = null;
		cancelIdleDrain();
	}

	function schedulePendingLanes(): void {
		if (disposed) return;
		if (queues["animation-frame"].size > 0) scheduleAnimationFrameDrain();
		if (queues["scroll-critical"].size > 0) scheduleCriticalDrain();
		if (queues["post-paint"].size > 0) schedulePostPaintDrain();
		if (queues.idle.size > 0) scheduleIdleDrain();
	}

	function setBoundOwnerWindow(nextWindow: Window | null): void {
		if (boundOwnerWindow === nextWindow) return;
		cancelAllHandles();
		boundOwnerWindow = nextWindow;
		schedulePendingLanes();
	}

	function bindOwnerElement(element: HTMLElement | null): void {
		if (disposed || boundOwnerElement === element) return;
		unregisterWindowMigration?.();
		unregisterWindowMigration = null;
		boundOwnerElement = element;
		setBoundOwnerWindow(element?.ownerDocument.defaultView ?? null);

		if (element && typeof element.onWindowMigrated === "function") {
			unregisterWindowMigration = element.onWindowMigrated((ownerWindow) => {
				setBoundOwnerWindow(ownerWindow);
			});
		}
	}

	return {
		schedule(lane, key, task): boolean {
			if (disposed || queues[lane].has(key)) return false;
			queues[lane].set(key, task);
			if (lane === "animation-frame") scheduleAnimationFrameDrain();
			else if (lane === "scroll-critical") scheduleCriticalDrain();
			else if (lane === "post-paint") schedulePostPaintDrain();
			else scheduleIdleDrain();
			return true;
		},
		cancel(lane, key): void {
			queues[lane].delete(key);
		},
		isScheduled: (lane, key) => queues[lane].has(key),
		bindOwnerElement,
		dispose(): void {
			if (disposed) return;
			disposed = true;
			unregisterWindowMigration?.();
			unregisterWindowMigration = null;
			boundOwnerElement = null;
			cancelAllHandles();
			for (const queue of Object.values(queues)) queue.clear();
			unsubscribeScrollActivity();
		},
	};
}
