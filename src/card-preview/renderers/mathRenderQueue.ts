import { finishRenderMath } from "obsidian";

export interface MathRenderTask {
	/** Renders into a detached surface and reports whether math was submitted. */
	render: () => Promise<boolean>;
	/** Publishes the detached result after the batch math render is finalized. */
	commit: () => Promise<void>;
}

type QueueTask = MathRenderTask & {
	cancelled: boolean;
	cleanup: () => void;
	key?: string;
	reject: (error: unknown) => void;
	resolve: () => void;
	signal?: AbortSignal;
	ownerWindow?: Window | null;
};

interface EnqueueMathRenderOptions {
	key?: string;
	priority?: "high" | "normal";
	signal?: AbortSignal;
	ownerWindow?: Window | null;
}

const IDLE_TIMEOUT_MS = 120;
const IDLE_FALLBACK_BUFFER_MS = 50;
let isBatchActive = false;
let isBatchScheduled = false;
const pendingTasks: QueueTask[] = [];
const queuedTaskByKey = new Map<string, QueueTask>();

function scheduleTask(task: () => void, ownerWindow?: Window | null): void {
	let hasRun = false;
	const runTask = () => {
		if (hasRun) return;
		hasRun = true;
		task();
	};

	const targetWindow = ownerWindow ?? (typeof window === "undefined" ? null : window);
	if (targetWindow) {
		if (typeof targetWindow.requestIdleCallback === "function") {
			const fallbackTimer = targetWindow.setTimeout(
				runTask,
				IDLE_TIMEOUT_MS + IDLE_FALLBACK_BUFFER_MS,
			);
			targetWindow.requestIdleCallback(
				() => {
					targetWindow.clearTimeout(fallbackTimer);
					runTask();
				},
				{ timeout: IDLE_TIMEOUT_MS },
			);
			return;
		}

		targetWindow.setTimeout(runTask, 0);
		return;
	}

	globalThis.setTimeout(runTask, 0);
}

function removePendingTask(task: QueueTask): boolean {
	const index = pendingTasks.indexOf(task);
	if (index < 0) {
		return false;
	}
	pendingTasks.splice(index, 1);
	return true;
}

function cleanupKeyMapping(task: QueueTask): void {
	if (!task.key) {
		return;
	}
	const queuedTask = queuedTaskByKey.get(task.key);
	if (queuedTask === task) {
		queuedTaskByKey.delete(task.key);
	}
}

function takePendingMathTasks(): QueueTask[] {
	return pendingTasks.splice(0).filter((task) => {
		if (!task.cancelled && !task.signal?.aborted) return true;
		cleanupKeyMapping(task);
		task.resolve();
		return false;
	});
}

async function renderBatch(batch: QueueTask[]): Promise<void> {
	const renderedTasks: QueueTask[] = [];
	let renderedMath = false;

	for (const task of batch) {
		if (task.cancelled || task.signal?.aborted) {
			task.resolve();
			continue;
		}

		try {
			renderedMath = (await task.render()) || renderedMath;
			renderedTasks.push(task);
		} catch (error) {
			task.reject(error);
		}
	}

	if (renderedMath) {
		try {
			await finishRenderMath();
		} catch (error) {
			for (const task of renderedTasks) {
				task.reject(error);
			}
			return;
		}
	}

	for (const task of renderedTasks) {
		if (task.cancelled || task.signal?.aborted) {
			task.resolve();
			continue;
		}

		try {
			await task.commit();
			task.resolve();
		} catch (error) {
			task.reject(error);
		}
	}
}

function processQueue(): void {
	if (isBatchActive || isBatchScheduled || pendingTasks.length === 0) return;

	isBatchScheduled = true;
	const ownerWindow = pendingTasks[0]?.ownerWindow;
	scheduleTask(() => {
		isBatchScheduled = false;
		const batch = takePendingMathTasks();
		if (batch.length === 0) {
			processQueue();
			return;
		}

		isBatchActive = true;
		void renderBatch(batch).finally(() => {
			for (const task of batch) {
				cleanupKeyMapping(task);
			}
			isBatchActive = false;
			processQueue();
		});
	}, ownerWindow);
}

/** Enqueues detached math rendering and its post-finalization DOM commit. */
export function enqueueMathRender(
	task: MathRenderTask,
	options: EnqueueMathRenderOptions = {},
): Promise<void> {
	const { signal, key, priority = "normal", ownerWindow } = options;

	return new Promise((resolve, reject) => {
		let settled = false;

		const settle = (handler: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			queueTask.cleanup();
			handler();
		};

		const queueTask: QueueTask = {
			...task,
			cancelled: false,
			cleanup: () => {},
			key,
			reject: (error) => settle(() => reject(error)),
			resolve: () => settle(() => resolve()),
			signal,
			ownerWindow,
		};

		if (signal?.aborted) {
			queueTask.resolve();
			return;
		}

		if (signal) {
			const onAbort = () => {
				queueTask.cancelled = true;
				removePendingTask(queueTask);
				cleanupKeyMapping(queueTask);
				queueTask.resolve();
			};
			signal.addEventListener("abort", onAbort, { once: true });
			queueTask.cleanup = () => {
				signal.removeEventListener("abort", onAbort);
			};
		}

		if (key) {
			const existingTask = queuedTaskByKey.get(key);
			if (existingTask && removePendingTask(existingTask)) {
				existingTask.cancelled = true;
				existingTask.resolve();
			}
			queuedTaskByKey.set(key, queueTask);
		}

		if (priority === "high") {
			pendingTasks.unshift(queueTask);
		} else {
			pendingTasks.push(queueTask);
		}
		processQueue();
	});
}

export function clearMathRenderQueue(): void {
	for (const task of pendingTasks.splice(0)) {
		task.cancelled = true;
		cleanupKeyMapping(task);
		task.resolve();
	}
	queuedTaskByKey.clear();
}
