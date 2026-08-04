type QueueTask = {
	cancelled: boolean;
	cleanup: () => void;
	key?: string;
	reject: (error: unknown) => void;
	resolve: () => void;
	run: () => Promise<void>;
	signal?: AbortSignal;
};

interface EnqueueMathRenderOptions {
	key?: string;
	priority?: "high" | "normal";
	signal?: AbortSignal;
}

const MAX_CONCURRENT_MATH_RENDERS = 1;
const IDLE_TIMEOUT_MS = 120;
const IDLE_FALLBACK_BUFFER_MS = 50;
let activeMathRenders = 0;
const pendingTasks: QueueTask[] = [];
const scheduledTasks = new Set<QueueTask>();
const queuedTaskByKey = new Map<string, QueueTask>();

function scheduleTask(task: () => void): void {
	let hasRun = false;
	const runTask = () => {
		if (hasRun) return;
		hasRun = true;
		task();
	};

	if (typeof window !== "undefined") {
		const requestIdleCallback = (
			window as Window & {
				requestIdleCallback?: (
					callback: () => void,
					options?: { timeout: number },
				) => number;
			}
		).requestIdleCallback;

		if (typeof requestIdleCallback === "function") {
			const fallbackTimer = window.setTimeout(
				runTask,
				IDLE_TIMEOUT_MS + IDLE_FALLBACK_BUFFER_MS,
			);
			requestIdleCallback(
				() => {
					window.clearTimeout(fallbackTimer);
					runTask();
				},
				{ timeout: IDLE_TIMEOUT_MS },
			);
			return;
		}
	}

	setTimeout(runTask, 0);
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

function processQueue(): void {
	while (activeMathRenders < MAX_CONCURRENT_MATH_RENDERS && pendingTasks.length > 0) {
		const nextTask = pendingTasks.shift();
		if (!nextTask) {
			return;
		}

		if (nextTask.cancelled || nextTask.signal?.aborted) {
			cleanupKeyMapping(nextTask);
			nextTask.resolve();
			continue;
		}

		scheduledTasks.add(nextTask);
		scheduleTask(() => {
			scheduledTasks.delete(nextTask);
			if (nextTask.cancelled || nextTask.signal?.aborted) {
				cleanupKeyMapping(nextTask);
				nextTask.resolve();
				processQueue();
				return;
			}

			activeMathRenders++;
			void nextTask
				.run()
				.then(() => {
					nextTask.resolve();
				})
				.catch((error) => {
					nextTask.reject(error);
				})
				.finally(() => {
					activeMathRenders = Math.max(activeMathRenders - 1, 0);
					cleanupKeyMapping(nextTask);
					processQueue();
				});
		});

		break;
	}
}

export function enqueueMathRender(
	task: () => Promise<void>,
	options: EnqueueMathRenderOptions = {},
): Promise<void> {
	const { signal, key, priority = "normal" } = options;

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
			cancelled: false,
			cleanup: () => {},
			key,
			reject: (error) => settle(() => reject(error)),
			resolve: () => settle(() => resolve()),
			run: task,
			signal,
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
	for (const task of scheduledTasks) {
		task.cancelled = true;
		cleanupKeyMapping(task);
		task.resolve();
	}
	scheduledTasks.clear();
	queuedTaskByKey.clear();
	activeMathRenders = 0;
}
