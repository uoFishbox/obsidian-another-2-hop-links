import type { PreviewData } from "../public-types";
import { createAbortError, isAbortError } from "./previewAbort";

const MAX_CONCURRENT_VISIBLE_PREVIEWS = 1;

export interface PreviewQueueTask {
	cancelled: boolean;
	cleanup: () => void;
	reject: (error: unknown) => void;
	resolve: (data: PreviewData) => void;
	run: () => Promise<PreviewData>;
	signal?: AbortSignal;
	started: boolean;
}

export interface PreviewQueueSnapshot {
	readonly queued: number;
	readonly active: number;
}

export type PreviewQueueListener = (snapshot: PreviewQueueSnapshot) => void;

export interface PreviewQueue {
	enqueue: (task: PreviewQueueTask) => Promise<PreviewData>;
	getActiveCount: () => number;
	getOutstandingCount: () => number;
	getSize: () => number;
	shutdown: () => void;
	subscribe: (listener: PreviewQueueListener) => () => void;
}

export function createPreviewQueue(): PreviewQueue {
	let activeVisiblePreviews = 0;
	const visibleQueue: PreviewQueueTask[] = [];
	const listeners = new Set<PreviewQueueListener>();
	let lastSnapshot: PreviewQueueSnapshot = { queued: 0, active: 0 };

	function getSize(): number {
		return visibleQueue.length;
	}

	function getActiveCount(): number {
		return activeVisiblePreviews;
	}

	function getOutstandingCount(): number {
		return visibleQueue.length + activeVisiblePreviews;
	}

	function notifyIfChanged(): void {
		const snapshot: PreviewQueueSnapshot = {
			queued: visibleQueue.length,
			active: activeVisiblePreviews,
		};
		if (
			snapshot.queued === lastSnapshot.queued &&
			snapshot.active === lastSnapshot.active
		) {
			return;
		}
		lastSnapshot = snapshot;
		for (const listener of listeners) listener(snapshot);
	}

	function subscribe(listener: PreviewQueueListener): () => void {
		listeners.add(listener);
		listener({ queued: visibleQueue.length, active: activeVisiblePreviews });
		return () => listeners.delete(listener);
	}

	function shutdown(): void {
		for (const task of visibleQueue) {
			task.cancelled = true;
			task.reject(createAbortError());
		}
		visibleQueue.length = 0;
		activeVisiblePreviews = 0;
		notifyIfChanged();
	}

	function enqueue(task: PreviewQueueTask): Promise<PreviewData> {
		return new Promise((resolve, reject) => {
			let settled = false;

			const settle = (handler: () => void): void => {
				if (settled) {
					return;
				}
				settled = true;
				task.cleanup();
				handler();
			};

			task.reject = (error) => settle(() => reject(error));
			task.resolve = (data) => settle(() => resolve(data));

			const signal = task.signal;
			if (signal?.aborted) {
				task.reject(createAbortError());
				return;
			}

			if (signal) {
				const onAbort = () => {
					if (task.started) {
						return;
					}

					task.cancelled = true;
					removeQueuedTask(task);
					task.reject(createAbortError());
				};
				signal.addEventListener("abort", onAbort, { once: true });
				task.cleanup = () => {
					signal.removeEventListener("abort", onAbort);
				};
			}

			visibleQueue.push(task);
			notifyIfChanged();
			processQueue();
		});
	}

	function processQueue(): void {
		drainQueue();
	}

	function drainQueue(): void {
		while (activeVisiblePreviews < MAX_CONCURRENT_VISIBLE_PREVIEWS) {
			const nextTask = visibleQueue.shift();
			if (!nextTask) {
				return;
			}
			notifyIfChanged();

			if (nextTask.cancelled || nextTask.signal?.aborted) {
				nextTask.reject(createAbortError());
				continue;
			}

			startTask(nextTask);
		}
	}

	function startTask(task: PreviewQueueTask): void {
		task.started = true;
		activeVisiblePreviews += 1;
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
				activeVisiblePreviews = Math.max(activeVisiblePreviews - 1, 0);
				notifyIfChanged();
				processQueue();
			});
	}

	function removeQueuedTask(task: PreviewQueueTask): void {
		const index = visibleQueue.indexOf(task);
		if (index >= 0) {
			visibleQueue.splice(index, 1);
			notifyIfChanged();
		}
	}

	return {
		enqueue,
		getActiveCount,
		getOutstandingCount,
		getSize,
		shutdown,
		subscribe,
	};
}
