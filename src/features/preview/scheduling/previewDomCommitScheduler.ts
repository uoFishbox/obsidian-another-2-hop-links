import { isScrollActivityActive } from "infrastructure/scroll/scrollActivity";

const MAX_REFILL_ELAPSED_MS = 250;
const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;
const DOM_COMMIT_TOKEN_EPSILON = 1e-9;
const FALLBACK_FRAME_INTERVAL_MS = 1000 / 60;

interface PreviewDomCommitPolicy {
	readonly commitsPerSecond: number;
	readonly burstCapacity: number;
	readonly maxDrainCpuMs: number;
}

const SCROLLING_POLICY: PreviewDomCommitPolicy = {
	commitsPerSecond: 90,
	burstCapacity: 1,
	maxDrainCpuMs: 1,
};
const IDLE_POLICY: PreviewDomCommitPolicy = {
	commitsPerSecond: 240,
	burstCapacity: 4,
	maxDrainCpuMs: 2,
};

export interface PreviewDomCommitTask {
	readonly targetKey: string;
	readonly revisionKey: string;
	readonly isStale: () => boolean;
	readonly commit: () => boolean;
}

interface QueuedPreviewDomCommitTask extends PreviewDomCommitTask {
	readonly resolve: (didCommit: boolean) => void;
	readonly reject: (error: unknown) => void;
	settled: boolean;
}

const pendingByTargetKey = new Map<string, QueuedPreviewDomCommitTask>();
let pendingQueue: QueuedPreviewDomCommitTask[] = [];
let pendingQueueHead = 0;
let frameHandle: number | null = null;
let frameHandleKind: "animation-frame" | "timeout" | null = null;
let availableCommitTokens = 0;
let lastTokenRefillTimestamp: number | null = null;

function readMonotonicTime(): number {
	if (typeof globalThis.performance?.now === "function") {
		return globalThis.performance.now();
	}
	return Date.now();
}

function settleTask(task: QueuedPreviewDomCommitTask, didCommit: boolean): void {
	if (task.settled) return;

	task.settled = true;
	if (pendingByTargetKey.get(task.targetKey) === task) {
		pendingByTargetKey.delete(task.targetKey);
	}
	task.resolve(didCommit);
}

function rejectTask(task: QueuedPreviewDomCommitTask, error: unknown): void {
	if (task.settled) return;

	task.settled = true;
	if (pendingByTargetKey.get(task.targetKey) === task) {
		pendingByTargetKey.delete(task.targetKey);
	}
	task.reject(error);
}

function readCommitPolicy(): PreviewDomCommitPolicy {
	return isScrollActivityActive() ? SCROLLING_POLICY : IDLE_POLICY;
}

function refillCommitTokens(timestamp: number, policy: PreviewDomCommitPolicy): void {
	if (lastTokenRefillTimestamp === null) {
		lastTokenRefillTimestamp = timestamp;
		availableCommitTokens = policy.burstCapacity;
		return;
	}

	const elapsedMs = Math.min(
		MAX_REFILL_ELAPSED_MS,
		Math.max(0, timestamp - lastTokenRefillTimestamp),
	);
	lastTokenRefillTimestamp = timestamp;
	availableCommitTokens = Math.min(
		policy.burstCapacity,
		availableCommitTokens + (elapsedMs * policy.commitsPerSecond) / 1000,
	);
}

function compactQueue(): void {
	if (
		pendingQueueHead < 64 &&
		pendingQueue.length <= pendingByTargetKey.size * 2 + 16
	) {
		return;
	}

	pendingQueue = pendingQueue
		.slice(pendingQueueHead)
		.filter(
			(task) => !task.settled && pendingByTargetKey.get(task.targetKey) === task,
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
			drainFrame(readMonotonicTime());
		}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
		return;
	}

	frameHandleKind = "animation-frame";
	frameHandle = globalThis.requestAnimationFrame((timestamp) => {
		frameHandle = null;
		frameHandleKind = null;
		drainFrame(timestamp);
	});
}

function drainFrame(frameTimestamp: number): void {
	const policy = readCommitPolicy();
	refillCommitTokens(frameTimestamp, policy);

	const deadline = readMonotonicTime() + policy.maxDrainCpuMs;
	let inspectedQueueEntries = 0;

	while (
		availableCommitTokens + DOM_COMMIT_TOKEN_EPSILON >= 1 &&
		inspectedQueueEntries < MAX_QUEUE_ENTRIES_PER_DRAIN &&
		readMonotonicTime() <= deadline
	) {
		const task = readNextQueuedTask();
		if (!task) break;
		inspectedQueueEntries += 1;
		if (task.settled) continue;
		if (pendingByTargetKey.get(task.targetKey) !== task) continue;

		if (task.isStale()) {
			settleTask(task, false);
			continue;
		}

		try {
			const didCommit = task.commit();
			settleTask(task, didCommit);
			if (didCommit) {
				availableCommitTokens = Math.max(0, availableCommitTokens - 1);
			}
		} catch (error) {
			rejectTask(task, error);
		}
	}

	compactQueue();

	if (pendingByTargetKey.size > 0) {
		scheduleFrameDrain();
	}
}

/**
 * Queues a live preview DOM replacement and coalesces older work by target.
 *
 * The returned promise resolves to `false` when the task was replaced or stale
 * before commit, or when `commit` found no DOM mutation to apply. It resolves
 * to `true` only after `commit` mutates the DOM.
 */
export function enqueuePreviewDomCommit(task: PreviewDomCommitTask): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const existingTask = pendingByTargetKey.get(task.targetKey);
		if (existingTask) {
			settleTask(existingTask, false);
			compactQueue();
		}

		const queuedTask: QueuedPreviewDomCommitTask = {
			...task,
			resolve,
			reject,
			settled: false,
		};
		pendingByTargetKey.set(task.targetKey, queuedTask);
		pendingQueue.push(queuedTask);
		scheduleFrameDrain();
	});
}

export function resetPreviewDomCommitSchedulerForTests(): void {
	for (const task of pendingQueue.splice(0)) {
		settleTask(task, false);
	}
	pendingQueueHead = 0;
	pendingByTargetKey.clear();
	availableCommitTokens = 0;
	lastTokenRefillTimestamp = null;

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
