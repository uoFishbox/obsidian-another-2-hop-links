import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "ui/virtualization/scheduling/scrollActivity";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	createPreviewFrameDriver,
	readPreviewSchedulingTime,
	type PreviewFrameDriver,
} from "./previewFrameDriver";
import {
	canConsumePreviewScheduleToken,
	consumePreviewScheduleToken,
	createEmptyPreviewScheduleTokenState,
	refillPreviewScheduleTokens,
	type PreviewScheduleTokenState,
} from "./previewScheduleTokenBucket";

const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;

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
	readonly frameCoordinator?: VirtualFrameCoordinator;
}

export type PreviewDomCommitResult =
	| { readonly type: "committed" }
	| {
			readonly type: "skipped";
			readonly reason: "replaced" | "stale" | "no-op" | "disposed";
	  };

interface QueuedPreviewDomCommitTask extends PreviewDomCommitTask {
	readonly partition: PreviewDomCommitPartition;
	readonly resolve: (result: PreviewDomCommitResult) => void;
	readonly reject: (error: unknown) => void;
	settled: boolean;
}

interface PreviewDomCommitPartition {
	readonly coordinator: VirtualFrameCoordinator | undefined;
	readonly driver: PreviewFrameDriver;
	readonly pendingByTargetKey: Map<string, QueuedPreviewDomCommitTask>;
	pendingQueue: QueuedPreviewDomCommitTask[];
	pendingQueueHead: number;
	tokenState: PreviewScheduleTokenState;
}

const FALLBACK_PARTITION_IDENTITY = {};
const pendingByTargetKey = new Map<string, QueuedPreviewDomCommitTask>();
const partitionsByIdentity = new Map<object, PreviewDomCommitPartition>();
let nextPartitionId = 0;
let unsubscribeScrollActivity: (() => void) | undefined;

function getOrCreatePartition(
	coordinator: VirtualFrameCoordinator | undefined,
): PreviewDomCommitPartition {
	const identity = coordinator ?? FALLBACK_PARTITION_IDENTITY;
	const existing = partitionsByIdentity.get(identity);
	if (existing) return existing;

	let partition: PreviewDomCommitPartition;
	const driver = createPreviewFrameDriver({
		coordinator,
		taskKey: `preview:dom-commit-drain:${++nextPartitionId}`,
		onAnimationFrameScheduled: () => {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.domCommitScheduler.animationFrame");
			}
		},
		onFrame: (timestamp) => drainPartition(partition, timestamp),
	});
	partition = {
		coordinator,
		driver,
		pendingByTargetKey: new Map(),
		pendingQueue: [],
		pendingQueueHead: 0,
		tokenState: createEmptyPreviewScheduleTokenState(),
	};
	partitionsByIdentity.set(identity, partition);
	return partition;
}

function settleTask(
	task: QueuedPreviewDomCommitTask,
	result: PreviewDomCommitResult,
): void {
	if (task.settled) return;

	task.settled = true;
	if (pendingByTargetKey.get(task.targetKey) === task) {
		pendingByTargetKey.delete(task.targetKey);
	}
	if (task.partition.pendingByTargetKey.get(task.targetKey) === task) {
		task.partition.pendingByTargetKey.delete(task.targetKey);
	}
	task.resolve(result);
	releasePartitionIfIdle(task.partition);
	releaseScrollActivitySubscriptionIfIdle();
}

function rejectTask(task: QueuedPreviewDomCommitTask, error: unknown): void {
	if (task.settled) return;

	task.settled = true;
	if (pendingByTargetKey.get(task.targetKey) === task) {
		pendingByTargetKey.delete(task.targetKey);
	}
	if (task.partition.pendingByTargetKey.get(task.targetKey) === task) {
		task.partition.pendingByTargetKey.delete(task.targetKey);
	}
	task.reject(error);
	releasePartitionIfIdle(task.partition);
	releaseScrollActivitySubscriptionIfIdle();
}

function compactQueue(partition: PreviewDomCommitPartition): void {
	if (
		partition.pendingQueueHead < 64 &&
		partition.pendingQueue.length <= partition.pendingByTargetKey.size * 2 + 16
	) {
		return;
	}

	partition.pendingQueue = partition.pendingQueue
		.slice(partition.pendingQueueHead)
		.filter(
			(task) =>
				!task.settled &&
				partition.pendingByTargetKey.get(task.targetKey) === task,
		);
	partition.pendingQueueHead = 0;
}

function readNextQueuedTask(
	partition: PreviewDomCommitPartition,
): QueuedPreviewDomCommitTask | undefined {
	if (partition.pendingQueueHead >= partition.pendingQueue.length) {
		return undefined;
	}

	const task = partition.pendingQueue[partition.pendingQueueHead];
	partition.pendingQueueHead += 1;
	return task;
}

function ensureScrollActivitySubscription(): void {
	if (unsubscribeScrollActivity) return;

	unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		if (isActive) {
			for (const partition of partitionsByIdentity.values()) {
				partition.driver.cancel();
			}
			return;
		}
		for (const partition of partitionsByIdentity.values()) {
			schedulePartition(partition);
		}
	});
}

function releaseScrollActivitySubscriptionIfIdle(): void {
	if (pendingByTargetKey.size > 0) return;
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

function schedulePartition(partition: PreviewDomCommitPartition): void {
	if (
		partition.pendingByTargetKey.size === 0 ||
		partition.driver.isScheduled() ||
		isScrollActivityActive()
	) {
		return;
	}
	partition.driver.schedule();
}

function releasePartitionIfIdle(partition: PreviewDomCommitPartition): void {
	if (partition.pendingByTargetKey.size > 0) return;

	partition.driver.dispose();
	partitionsByIdentity.delete(partition.coordinator ?? FALLBACK_PARTITION_IDENTITY);
}

function drainPartition(
	partition: PreviewDomCommitPartition,
	frameTimestamp: number,
): void {
	if (isScrollActivityActive()) return;

	partition.tokenState = refillPreviewScheduleTokens(
		partition.tokenState,
		frameTimestamp,
		IDLE_POLICY,
	);
	const deadline = readPreviewSchedulingTime() + IDLE_POLICY.maxDrainCpuMs;
	const queueEntriesAvailableAtDrainStart = Math.max(
		0,
		partition.pendingQueue.length - partition.pendingQueueHead,
	);
	const maxInspectableQueueEntries = Math.min(
		MAX_QUEUE_ENTRIES_PER_DRAIN,
		queueEntriesAvailableAtDrainStart,
	);
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumePreviewScheduleToken(partition.tokenState) &&
		drainedTasks < IDLE_POLICY.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readPreviewSchedulingTime() <= deadline
	) {
		const task = readNextQueuedTask(partition);
		if (!task) break;
		inspectedQueueEntries += 1;
		if (task.settled) continue;
		if (partition.pendingByTargetKey.get(task.targetKey) !== task) continue;

		if (task.isStale()) {
			settleTask(task, { type: "skipped", reason: "stale" });
			continue;
		}

		if (isScrollActivityActive()) {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.domCommitDuringScroll");
			}
			partition.pendingQueue.push(task);
			break;
		}

		drainedTasks += 1;
		try {
			const didCommit = task.commit();
			settleTask(
				task,
				didCommit
					? { type: "committed" }
					: { type: "skipped", reason: "no-op" },
			);
			if (didCommit) {
				partition.tokenState = consumePreviewScheduleToken(
					partition.tokenState,
				);
			}
		} catch (error) {
			rejectTask(task, error);
		}
	}

	compactQueue(partition);
	if (partition.pendingByTargetKey.size > 0) schedulePartition(partition);
}

/**
 * Queues a live preview DOM replacement and coalesces older work by target.
 */
export function enqueuePreviewDomCommit(
	task: PreviewDomCommitTask,
): Promise<PreviewDomCommitResult> {
	return new Promise<PreviewDomCommitResult>((resolve, reject) => {
		const existingTask = pendingByTargetKey.get(task.targetKey);
		if (existingTask) {
			settleTask(existingTask, { type: "skipped", reason: "replaced" });
			compactQueue(existingTask.partition);
		}

		const partition = getOrCreatePartition(task.frameCoordinator);
		const queuedTask: QueuedPreviewDomCommitTask = {
			...task,
			partition,
			resolve,
			reject,
			settled: false,
		};
		pendingByTargetKey.set(task.targetKey, queuedTask);
		partition.pendingByTargetKey.set(task.targetKey, queuedTask);
		partition.pendingQueue.push(queuedTask);
		ensureScrollActivitySubscription();
		schedulePartition(partition);
	});
}

/** Stops DOM commit scheduling and settles all pending commit requests. */
export function disposePreviewDomCommitScheduler(): void {
	for (const task of Array.from(pendingByTargetKey.values())) {
		settleTask(task, { type: "skipped", reason: "disposed" });
	}
	pendingByTargetKey.clear();
	for (const partition of partitionsByIdentity.values()) {
		partition.pendingQueue = [];
		partition.pendingQueueHead = 0;
		partition.pendingByTargetKey.clear();
		partition.tokenState = createEmptyPreviewScheduleTokenState();
		partition.driver.dispose();
	}
	partitionsByIdentity.clear();
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

export function resetPreviewDomCommitSchedulerForTests(): void {
	disposePreviewDomCommitScheduler();
}
