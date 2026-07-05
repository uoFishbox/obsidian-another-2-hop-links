import { isScrollActivityActive } from "infrastructure/scroll/scrollActivity";

const SCROLLING_DOM_COMMITS_PER_FRAME = 1;
const IDLE_DOM_COMMITS_PER_FRAME = 4;

export interface PreviewDomCommitTask {
	readonly key: string;
	readonly isStale: () => boolean;
	readonly commit: () => void;
}

interface QueuedPreviewDomCommitTask extends PreviewDomCommitTask {
	readonly resolve: (didCommit: boolean) => void;
	readonly reject: (error: unknown) => void;
	settled: boolean;
}

const pendingByKey = new Map<string, QueuedPreviewDomCommitTask>();
let pendingQueue: QueuedPreviewDomCommitTask[] = [];
let pendingQueueHead = 0;
let frameHandle: number | null = null;
let frameHandleKind: "animation-frame" | "timeout" | null = null;

function settleTask(task: QueuedPreviewDomCommitTask, didCommit: boolean): void {
	if (task.settled) return;

	task.settled = true;
	if (pendingByKey.get(task.key) === task) {
		pendingByKey.delete(task.key);
	}
	task.resolve(didCommit);
}

function rejectTask(task: QueuedPreviewDomCommitTask, error: unknown): void {
	if (task.settled) return;

	task.settled = true;
	if (pendingByKey.get(task.key) === task) {
		pendingByKey.delete(task.key);
	}
	task.reject(error);
}

function readFrameBudget(): number {
	return isScrollActivityActive()
		? SCROLLING_DOM_COMMITS_PER_FRAME
		: IDLE_DOM_COMMITS_PER_FRAME;
}

function compactQueue(): void {
	if (
		pendingQueueHead < 64 &&
		pendingQueue.length <= pendingByKey.size * 2 + 16
	) {
		return;
	}

	pendingQueue = pendingQueue.slice(pendingQueueHead).filter(
		(task) => !task.settled && pendingByKey.get(task.key) === task,
	);
	pendingQueueHead = 0;
}

function readNextQueuedTask(): QueuedPreviewDomCommitTask | undefined {
	if (pendingQueueHead >= pendingQueue.length) return undefined;

	const task = pendingQueue[pendingQueueHead];
	pendingQueueHead += 1;
	return task;
}

function scheduleFrameDrain(): void {
	if (frameHandle !== null) return;

	if (typeof globalThis.requestAnimationFrame !== "function") {
		frameHandleKind = "timeout";
		frameHandle = globalThis.setTimeout(() => {
			frameHandle = null;
			frameHandleKind = null;
			drainFrame();
		}, 0) as unknown as number;
		return;
	}

	frameHandleKind = "animation-frame";
	frameHandle = globalThis.requestAnimationFrame(() => {
		frameHandle = null;
		frameHandleKind = null;
		drainFrame();
	});
}

function drainFrame(): void {
	const commitBudget = readFrameBudget();
	let committed = 0;

	while (committed < commitBudget) {
		const task = readNextQueuedTask();
		if (!task) break;
		if (task.settled) continue;
		if (pendingByKey.get(task.key) !== task) continue;

		if (task.isStale()) {
			settleTask(task, false);
			continue;
		}

		try {
			task.commit();
			settleTask(task, true);
			committed += 1;
		} catch (error) {
			rejectTask(task, error);
		}
	}

	compactQueue();

	if (pendingByKey.size > 0) {
		scheduleFrameDrain();
	}
}

/**
 * Queues a live preview DOM replacement and coalesces older work by key.
 *
 * The returned promise resolves to `false` when the task was replaced or stale
 * before commit, and resolves to `true` only after `commit` has run.
 */
export function enqueuePreviewDomCommit(task: PreviewDomCommitTask): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const existingTask = pendingByKey.get(task.key);
		if (existingTask) {
			settleTask(existingTask, false);
		}

		const queuedTask: QueuedPreviewDomCommitTask = {
			...task,
			resolve,
			reject,
			settled: false,
		};
		pendingByKey.set(task.key, queuedTask);
		pendingQueue.push(queuedTask);
		scheduleFrameDrain();
	});
}

export function resetPreviewDomCommitSchedulerForTests(): void {
	for (const task of pendingQueue.splice(0)) {
		settleTask(task, false);
	}
	pendingQueueHead = 0;
	pendingByKey.clear();

	if (frameHandle !== null) {
		if (
			frameHandleKind === "animation-frame" &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(frameHandle);
		} else {
			globalThis.clearTimeout(frameHandle);
		}
		frameHandle = null;
		frameHandleKind = null;
	}
}
