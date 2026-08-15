import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

type RenderTask<T> = {
	cancelled: boolean;
	cleanup: () => void;
	reject: (error: unknown) => void;
	resolve: (value: T) => void;
	run: () => Promise<T>;
	signal?: AbortSignal;
};

const MAX_CONCURRENT_PREVIEW_RENDERS = 1;
let activePreviewRenders = 0;
const pendingTasks: RenderTask<unknown>[] = [];
const scheduledTasks = new Set<RenderTask<unknown>>();

function createAbortError(): DOMException {
	return new DOMException("Preview render aborted", "AbortError");
}

function scheduleTask(task: () => void): void {
	if (typeof window !== "undefined") {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("preview.renderScheduler.animationFrame");
		}
		window.requestAnimationFrame(() => task());
		return;
	}

	setTimeout(task, 0);
}

function removePendingTask(task: RenderTask<unknown>): boolean {
	const index = pendingTasks.indexOf(task);
	if (index < 0) {
		return false;
	}
	pendingTasks.splice(index, 1);
	return true;
}

function drainPreviewRenderQueue(): void {
	if (activePreviewRenders >= MAX_CONCURRENT_PREVIEW_RENDERS) {
		return;
	}

	const nextTask = pendingTasks.shift();
	if (!nextTask) {
		return;
	}

	if (nextTask.cancelled || nextTask.signal?.aborted) {
		nextTask.reject(createAbortError());
		drainPreviewRenderQueue();
		return;
	}

	activePreviewRenders++;
	scheduledTasks.add(nextTask);

	scheduleTask(() => {
		scheduledTasks.delete(nextTask);

		if (nextTask.cancelled || nextTask.signal?.aborted) {
			activePreviewRenders = Math.max(activePreviewRenders - 1, 0);
			nextTask.reject(createAbortError());
			drainPreviewRenderQueue();
			return;
		}

		void nextTask
			.run()
			.then(nextTask.resolve)
			.catch(nextTask.reject)
			.finally(() => {
				activePreviewRenders = Math.max(activePreviewRenders - 1, 0);
				drainPreviewRenderQueue();
			});
	});
}

export function enqueuePreviewRender<T>(
	run: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;

		const settle = (handler: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			task.cleanup();
			handler();
		};

		const task: RenderTask<T> = {
			cancelled: false,
			cleanup: () => {},
			reject: (error) => settle(() => reject(error)),
			resolve: (value) => settle(() => resolve(value)),
			run,
			signal,
		};

		if (signal?.aborted) {
			task.reject(createAbortError());
			return;
		}

		if (signal) {
			const onAbort = () => {
				task.cancelled = true;
				if (removePendingTask(task as RenderTask<unknown>)) {
					task.reject(createAbortError());
					drainPreviewRenderQueue();
				}
			};
			signal.addEventListener("abort", onAbort, { once: true });
			task.cleanup = () => {
				signal.removeEventListener("abort", onAbort);
			};
		}

		pendingTasks.push(task as RenderTask<unknown>);
		drainPreviewRenderQueue();
	});
}

export function clearPreviewRenderQueue(): void {
	for (const task of pendingTasks.splice(0)) {
		task.cancelled = true;
		task.reject(createAbortError());
	}
	for (const task of scheduledTasks) {
		task.cancelled = true;
		task.reject(createAbortError());
	}
	scheduledTasks.clear();
	activePreviewRenders = 0;
}
