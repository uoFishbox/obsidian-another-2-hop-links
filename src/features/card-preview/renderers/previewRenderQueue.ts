import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

const MAX_TASKS_PER_DRAIN = 4;
const MAX_DRAIN_CPU_MS = 2;
const ANIMATION_FRAME_WATCHDOG_MS = 100;

type RenderTaskState = "pending" | "running" | "settled";

type RenderTask<T> = {
	cleanup: () => void;
	partition: RenderQueuePartition;
	reject: (error: unknown) => void;
	resolve: (value: T) => void;
	run: () => Promise<T>;
	signal?: AbortSignal;
	state: RenderTaskState;
};

interface RenderQueuePartition {
	readonly key: object;
	readonly ownerWindow: Window | null;
	readonly pendingTasks: RenderTask<unknown>[];
	cancelScheduledDrain: (() => void) | null;
	draining: boolean;
	runningTask: RenderTask<unknown> | null;
}

export type EnqueuePreviewRender = <T>(
	run: () => Promise<T>,
	signal?: AbortSignal,
	ownerWindow?: Window | null,
) => Promise<T>;

export interface PreviewRenderQueue {
	/** Enqueues detached preview DOM work in its owner window partition. */
	enqueue: EnqueuePreviewRender;
	/** Rejects queued work and prevents the queue from accepting new tasks. */
	dispose(): void;
}

export interface CreatePreviewRenderQueueOptions {
	/** Resolves the visible realm used to schedule partition drains. */
	getSchedulingWindow?: () => Window | null;
}

function createAbortError(): DOMException {
	return new DOMException("Preview render aborted", "AbortError");
}

function readSchedulingTime(): number {
	if (typeof globalThis.performance?.now === "function") {
		return globalThis.performance.now();
	}
	return Date.now();
}

/**
 * Creates a render queue owned by one preview runtime.
 *
 * Work is partitioned by DOM owner window so a stalled popout cannot hold the
 * render capacity of another realm. A drain starts at most four serialized
 * tasks per frame, avoiding the former one-preview-per-frame throughput cap.
 */
export function createPreviewRenderQueue(
	options: CreatePreviewRenderQueueOptions = {},
): PreviewRenderQueue {
	const fallbackPartitionKey = {};
	const partitions = new Map<object, RenderQueuePartition>();
	let disposed = false;

	function resolveOwnerWindow(ownerWindow?: Window | null): Window | null {
		return ownerWindow ?? (typeof window === "undefined" ? null : window);
	}

	function getOrCreatePartition(ownerWindow: Window | null): RenderQueuePartition {
		const key = ownerWindow ?? fallbackPartitionKey;
		const existing = partitions.get(key);
		if (existing) return existing;

		const partition: RenderQueuePartition = {
			key,
			ownerWindow,
			pendingTasks: [],
			cancelScheduledDrain: null,
			draining: false,
			runningTask: null,
		};
		partitions.set(key, partition);
		return partition;
	}

	function removePartitionIfIdle(partition: RenderQueuePartition): void {
		if (partition.pendingTasks.length > 0) return;
		if (partition.cancelScheduledDrain || partition.draining) return;
		if (partitions.get(partition.key) === partition) {
			partitions.delete(partition.key);
		}
	}

	function removePendingTask(task: RenderTask<unknown>): boolean {
		const index = task.partition.pendingTasks.indexOf(task);
		if (index < 0) return false;
		task.partition.pendingTasks.splice(index, 1);
		return true;
	}

	function cancelIdlePartitionSchedule(partition: RenderQueuePartition): void {
		if (partition.pendingTasks.length > 0 || partition.draining) return;
		partition.cancelScheduledDrain?.();
		partition.cancelScheduledDrain = null;
		removePartitionIfIdle(partition);
	}

	function scheduleOnAnimationFrame(
		partition: RenderQueuePartition,
		callback: () => void,
	): () => void {
		let schedulingWindow = partition.ownerWindow;
		try {
			schedulingWindow = options.getSchedulingWindow?.() ?? partition.ownerWindow;
		} catch {
			// Workspace teardown can invalidate realm lookup. The owner realm and
			// global watchdog remain valid fallbacks for settling queued work.
		}
		let completed = false;
		const cancellations: Array<() => void> = [];

		const cancel = (): void => {
			if (completed) return;
			completed = true;
			for (const cancelScheduledWork of cancellations) {
				cancelScheduledWork();
			}
		};
		const runOnce = (): void => {
			if (completed) return;
			completed = true;
			for (const cancelScheduledWork of cancellations) {
				cancelScheduledWork();
			}
			callback();
		};

		if (
			schedulingWindow &&
			typeof schedulingWindow.requestAnimationFrame === "function"
		) {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.renderScheduler.animationFrame");
			}
			try {
				const frameHandle = schedulingWindow.requestAnimationFrame(runOnce);
				const cancelFrame = (): void => {
					if (typeof schedulingWindow.cancelAnimationFrame === "function") {
						schedulingWindow.cancelAnimationFrame(frameHandle);
					}
				};
				if (completed) {
					cancelFrame();
					return cancel;
				}
				cancellations.push(cancelFrame);

				// Keep the watchdog outside the target window. A closed or throttled
				// popout must not retain the queue merely because its rAF never fires.
				const watchdogHandle = globalThis.setTimeout(
					runOnce,
					ANIMATION_FRAME_WATCHDOG_MS,
				);
				cancellations.push(() => globalThis.clearTimeout(watchdogHandle));
				return cancel;
			} catch {
				// A closing popout may reject new callbacks. Fall through to the
				// realm-independent timeout path instead of rejecting the render.
			}
		}

		const timeoutHandle = globalThis.setTimeout(runOnce, 0);
		cancellations.push(() => globalThis.clearTimeout(timeoutHandle));
		return cancel;
	}

	function schedulePartitionDrain(partition: RenderQueuePartition): void {
		if (disposed || partition.draining || partition.cancelScheduledDrain) return;
		if (partition.pendingTasks.length === 0) {
			removePartitionIfIdle(partition);
			return;
		}

		let ranSynchronously = false;
		const cancelScheduledDrain = scheduleOnAnimationFrame(partition, () => {
			ranSynchronously = true;
			partition.cancelScheduledDrain = null;
			void drainPartition(partition);
		});
		partition.cancelScheduledDrain = ranSynchronously ? null : cancelScheduledDrain;
	}

	async function drainPartition(partition: RenderQueuePartition): Promise<void> {
		if (disposed || partition.draining) return;
		partition.draining = true;
		const startedAt = readSchedulingTime();
		let startedTaskCount = 0;

		try {
			while (!disposed && startedTaskCount < MAX_TASKS_PER_DRAIN) {
				const task = partition.pendingTasks.shift();
				if (!task) break;

				if (task.state !== "pending" || task.signal?.aborted) {
					task.reject(createAbortError());
					continue;
				}

				task.state = "running";
				partition.runningTask = task;
				startedTaskCount++;
				try {
					const value = await task.run();
					task.resolve(value);
				} catch (error) {
					task.reject(error);
				} finally {
					partition.runningTask = null;
				}

				if (readSchedulingTime() - startedAt >= MAX_DRAIN_CPU_MS) break;
			}
		} finally {
			partition.draining = false;
			if (!disposed && partition.pendingTasks.length > 0) {
				schedulePartitionDrain(partition);
			} else {
				removePartitionIfIdle(partition);
			}
		}
	}

	function enqueue<T>(
		run: () => Promise<T>,
		signal?: AbortSignal,
		ownerWindow?: Window | null,
	): Promise<T> {
		if (disposed || signal?.aborted) {
			return Promise.reject(createAbortError());
		}

		return new Promise<T>((resolve, reject) => {
			const partition = getOrCreatePartition(resolveOwnerWindow(ownerWindow));
			const settle = (handler: () => void): void => {
				if (task.state === "settled") return;
				task.state = "settled";
				task.cleanup();
				handler();
			};
			const task: RenderTask<T> = {
				cleanup: () => {},
				partition,
				reject: (error) => settle(() => reject(error)),
				resolve: (value) => settle(() => resolve(value)),
				run,
				signal,
				state: "pending",
			};

			if (signal) {
				const onAbort = (): void => {
					const wasPending = removePendingTask(task as RenderTask<unknown>);
					task.reject(createAbortError());
					if (wasPending) cancelIdlePartitionSchedule(partition);
				};
				signal.addEventListener("abort", onAbort, { once: true });
				task.cleanup = () => signal.removeEventListener("abort", onAbort);
			}

			partition.pendingTasks.push(task as RenderTask<unknown>);
			schedulePartitionDrain(partition);
		});
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;

		for (const partition of partitions.values()) {
			partition.cancelScheduledDrain?.();
			partition.cancelScheduledDrain = null;
			for (const task of partition.pendingTasks.splice(0)) {
				task.reject(createAbortError());
			}
			partition.runningTask?.reject(createAbortError());
		}
		partitions.clear();
	}

	return { enqueue, dispose };
}
