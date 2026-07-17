import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "infrastructure/scroll/scrollActivity";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	canConsumePreviewScheduleToken,
	consumePreviewScheduleToken,
	createEmptyPreviewScheduleTokenState,
	refillPreviewScheduleTokens,
	type PreviewScheduleTokenState,
} from "./previewScheduleTokenBucket";

const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;
const FALLBACK_FRAME_INTERVAL_MS = 1000 / 60;

interface PreviewDomCommitPolicy {
	readonly ratePerSecond: number;
	readonly creditCapacity: number;
	readonly maxTasksPerDrain: number;
	readonly maxDrainCpuMs: number;
}

const IDLE_POLICY: PreviewDomCommitPolicy = {
	ratePerSecond: 240,
	creditCapacity: 4,
	maxTasksPerDrain: 4,
	maxDrainCpuMs: 2,
};

export interface PreviewDomCommitTask {
	readonly targetKey: string;
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
let commitTokenState: PreviewScheduleTokenState =
	createEmptyPreviewScheduleTokenState();
let unsubscribeScrollActivity: (() => void) | undefined;

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

function refillCommitTokens(timestamp: number, policy: PreviewDomCommitPolicy): void {
	commitTokenState = refillPreviewScheduleTokens(commitTokenState, timestamp, policy);
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

function cancelFrameDrain(): void {
	if (frameHandle === null) return;

	if (
		frameHandleKind === "animation-frame" &&
		typeof globalThis.cancelAnimationFrame === "function"
	) {
		globalThis.cancelAnimationFrame(frameHandle);
	} else if (typeof globalThis.clearTimeout === "function") {
		globalThis.clearTimeout(frameHandle);
	}

	frameHandle = null;
	frameHandleKind = null;
}

function ensureScrollActivitySubscription(): void {
	if (unsubscribeScrollActivity) return;

	unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		if (isActive) {
			cancelFrameDrain();
			return;
		}
		scheduleFrameDrain();
	});
}

function releaseScrollActivitySubscriptionIfIdle(): void {
	if (pendingByTargetKey.size > 0) return;
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

function scheduleFrameDrain(): void {
	if (
		frameHandle !== null ||
		pendingByTargetKey.size === 0 ||
		isScrollActivityActive()
	) {
		return;
	}

	if (typeof globalThis.requestAnimationFrame !== "function") {
		frameHandleKind = "timeout";
		frameHandle = globalThis.setTimeout(() => {
			frameHandle = null;
			frameHandleKind = null;
			drainFrame(readMonotonicTime());
		}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
		return;
	}

	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("preview.domCommitScheduler.animationFrame");
	}
	frameHandleKind = "animation-frame";
	frameHandle = globalThis.requestAnimationFrame((timestamp) => {
		frameHandle = null;
		frameHandleKind = null;
		drainFrame(timestamp);
	});
}

function drainFrame(frameTimestamp: number): void {
	if (isScrollActivityActive()) return;

	const policy = IDLE_POLICY;
	refillCommitTokens(frameTimestamp, policy);

	const deadline = readMonotonicTime() + policy.maxDrainCpuMs;
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumePreviewScheduleToken(commitTokenState) &&
		drainedTasks < policy.maxTasksPerDrain &&
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

		if (isScrollActivityActive()) {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.domCommitDuringScroll");
			}
			pendingQueue.push(task);
			break;
		}

		drainedTasks += 1;
		try {
			const didCommit = task.commit();
			settleTask(task, didCommit);
			if (didCommit) {
				commitTokenState = consumePreviewScheduleToken(commitTokenState);
			}
		} catch (error) {
			rejectTask(task, error);
		}
	}

	compactQueue();

	if (pendingByTargetKey.size > 0) {
		scheduleFrameDrain();
	} else {
		releaseScrollActivitySubscriptionIfIdle();
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
		ensureScrollActivitySubscription();
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
		ensureScrollActivitySubscription();
		scheduleFrameDrain();
	});
}

/**
 * Stops DOM commit scheduling and settles all pending commit requests.
 */
export function disposePreviewDomCommitScheduler(): void {
	for (const task of pendingQueue.splice(0)) {
		settleTask(task, false);
	}
	pendingQueueHead = 0;
	pendingByTargetKey.clear();
	commitTokenState = createEmptyPreviewScheduleTokenState();
	cancelFrameDrain();
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

export function resetPreviewDomCommitSchedulerForTests(): void {
	disposePreviewDomCommitScheduler();
}
