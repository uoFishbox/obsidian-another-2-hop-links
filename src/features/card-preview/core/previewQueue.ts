import type { PreviewData } from "../public-types";
import { createAbortError, isAbortError } from "./previewAbort";

const MAX_CONCURRENT_VISIBLE_PREVIEWS = 1;

export interface PreviewQueueSnapshot {
	readonly queued: number;
	readonly active: number;
}

export type PreviewQueueListener = (snapshot: PreviewQueueSnapshot) => void;

interface QueuedPreviewTask {
	readonly run: () => Promise<PreviewData>;
	readonly signal?: AbortSignal;
	started: boolean;
	cancelled: boolean;
	resolve(data: PreviewData): void;
	reject(error: unknown): void;
	cleanup(): void;
}

export function createPreviewQueue() {
	let activeCount = 0;
	const queue: QueuedPreviewTask[] = [];
	const listeners = new Set<PreviewQueueListener>();
	let lastQueued = 0;
	let lastActive = 0;

	function notifyIfChanged(): void {
		if (queue.length === lastQueued && activeCount === lastActive) return;
		lastQueued = queue.length;
		lastActive = activeCount;
		const snapshot = { queued: lastQueued, active: lastActive };
		for (const listener of listeners) listener(snapshot);
	}

	function subscribe(listener: PreviewQueueListener): () => void {
		listeners.add(listener);
		listener({ queued: queue.length, active: activeCount });
		return () => listeners.delete(listener);
	}

	function removeQueuedTask(task: QueuedPreviewTask): void {
		const index = queue.indexOf(task);
		if (index < 0) return;
		queue.splice(index, 1);
		notifyIfChanged();
	}

	function enqueue(
		run: () => Promise<PreviewData>,
		signal?: AbortSignal,
	): Promise<PreviewData> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const task: QueuedPreviewTask = {
				run,
				signal,
				started: false,
				cancelled: false,
				resolve: () => {},
				reject: () => {},
				cleanup: () => {},
			};

			const settle = (handler: () => void): void => {
				if (settled) return;
				settled = true;
				task.cleanup();
				handler();
			};
			task.resolve = (data) => settle(() => resolve(data));
			task.reject = (error) => settle(() => reject(error));

			if (signal?.aborted) {
				task.reject(createAbortError());
				return;
			}
			if (signal) {
				const onAbort = () => {
					if (task.started) return;
					task.cancelled = true;
					removeQueuedTask(task);
					task.reject(createAbortError());
				};
				signal.addEventListener("abort", onAbort, { once: true });
				task.cleanup = () => signal.removeEventListener("abort", onAbort);
			}

			queue.push(task);
			notifyIfChanged();
			drainQueue();
		});
	}

	function drainQueue(): void {
		while (activeCount < MAX_CONCURRENT_VISIBLE_PREVIEWS) {
			const task = queue.shift();
			if (!task) return;
			notifyIfChanged();
			if (task.cancelled || task.signal?.aborted) {
				task.reject(createAbortError());
				continue;
			}
			startTask(task);
		}
	}

	function startTask(task: QueuedPreviewTask): void {
		task.started = true;
		activeCount += 1;
		notifyIfChanged();

		void task
			.run()
			.then((result) => {
				if (task.cancelled || task.signal?.aborted) {
					task.reject(createAbortError());
					return;
				}
				task.resolve(result);
			})
			.catch((error) => {
				if (task.cancelled || task.signal?.aborted || isAbortError(error)) {
					task.reject(createAbortError());
					return;
				}
				task.reject(error);
			})
			.finally(() => {
				activeCount = Math.max(activeCount - 1, 0);
				notifyIfChanged();
				drainQueue();
			});
	}

	function shutdown(): void {
		for (const task of queue) {
			task.cancelled = true;
			task.reject(createAbortError());
		}
		queue.length = 0;
		activeCount = 0;
		notifyIfChanged();
	}

	return {
		enqueue,
		getQueuedCount: () => queue.length,
		getActiveCount: () => activeCount,
		getOutstandingCount: () => queue.length + activeCount,
		shutdown,
		subscribe,
	};
}
