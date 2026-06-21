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

export interface PreviewQueue {
	enqueue: (task: PreviewQueueTask) => Promise<PreviewData>;
	getActiveCount: () => number;
	getSize: () => number;
	shutdown: () => void;
}

export function createPreviewQueue(): PreviewQueue {
	let activeVisiblePreviews = 0;
	const visibleQueue: PreviewQueueTask[] = [];

	function getSize(): number {
		return visibleQueue.length;
	}

	function getActiveCount(): number {
		return activeVisiblePreviews;
	}

	function shutdown(): void {
		for (const task of visibleQueue) {
			task.cancelled = true;
			task.reject(createAbortError());
		}
		visibleQueue.length = 0;
		activeVisiblePreviews = 0;
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
				if (
					task.cancelled ||
					task.signal?.aborted ||
					isAbortError(error)
				) {
					task.reject(createAbortError());
					return;
				}
				task.reject(error);
			})
			.finally(() => {
				activeVisiblePreviews = Math.max(activeVisiblePreviews - 1, 0);
				processQueue();
			});
	}

	function removeQueuedTask(task: PreviewQueueTask): void {
		const index = visibleQueue.indexOf(task);
		if (index >= 0) {
			visibleQueue.splice(index, 1);
		}
	}

	return {
		enqueue,
		getActiveCount,
		getSize,
		shutdown,
	};
}
