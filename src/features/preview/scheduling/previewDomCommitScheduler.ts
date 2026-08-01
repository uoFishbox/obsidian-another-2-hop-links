import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND } from "appConstants";
import { hasPendingBrowserInput } from "core/indexing/timeSlicing";
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
const EXPECTED_FRAME_INTERVAL_MS = 1000 / 60;
const SCROLLING_REEVALUATION_DELAY_MS = EXPECTED_FRAME_INTERVAL_MS * 2;

interface PreviewDomCommitPolicy {
	readonly mode: "idle" | "scrolling";
	readonly ratePerSecond: number;
	readonly creditCapacity: number;
	readonly initialCredits?: number;
	readonly maxTasksPerDrain: number;
	readonly maxDrainCpuMs: number;
}

const IDLE_POLICY: PreviewDomCommitPolicy = {
	mode: "idle",
	ratePerSecond: 240,
	creditCapacity: 4,
	maxTasksPerDrain: 4,
	maxDrainCpuMs: 2,
};
const SCROLLING_POLICY: PreviewDomCommitPolicy = {
	mode: "scrolling",
	ratePerSecond: DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	creditCapacity: 4,
	initialCredits: 1,
	maxTasksPerDrain: 4,
	maxDrainCpuMs: 0.75,
};

export interface PreviewDomCommitTask {
	readonly targetKey: string;
	readonly isStale: () => boolean;
	readonly commit: () => boolean;
	readonly frameCoordinator?: VirtualFrameCoordinator;
	/** Resolves the maximum DOM commits per second while scrolling. */
	readonly getCommitsPerSecond?: () => number;
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
	readonly getCommitsPerSecond: () => number;
	pendingQueue: QueuedPreviewDomCommitTask[];
	pendingQueueHead: number;
	tokenState: PreviewScheduleTokenState;
}

const FALLBACK_PARTITION_IDENTITY = {};
const pendingByTargetKey = new Map<string, QueuedPreviewDomCommitTask>();
// Keep token state across idle gaps so sparse arrivals cannot regain initial credit.
const partitionsByIdentity = new Map<object, PreviewDomCommitPartition>();
let nextPartitionId = 0;
let unsubscribeScrollActivity: (() => void) | undefined;

function getDefaultCommitsPerSecond(): number {
	return DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND;
}

function resolvePositiveRate(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getOrCreatePartition(
	coordinator: VirtualFrameCoordinator | undefined,
	getCommitsPerSecond: (() => number) | undefined,
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
		getCommitsPerSecond: getCommitsPerSecond ?? getDefaultCommitsPerSecond,
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
		for (const partition of partitionsByIdentity.values()) {
			partition.driver.cancel();
			schedulePartition(partition, 0, isActive);
		}
	});
}

function releaseScrollActivitySubscriptionIfIdle(): void {
	if (pendingByTargetKey.size > 0) return;
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

function schedulePartition(
	partition: PreviewDomCommitPartition,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (partition.pendingByTargetKey.size === 0 || partition.driver.isScheduled()) {
		return;
	}
	partition.driver.schedule({
		lane: scrolling ? "post-paint" : "idle",
		delayMs,
	});
}

function readTokenAvailabilityDelayMs(
	tokenState: PreviewScheduleTokenState,
	ratePerSecond: number,
): number {
	if (canConsumePreviewScheduleToken(tokenState)) return 0;

	const missingCredits = Math.max(0, 1 - tokenState.availableCredits);
	const availabilityDelayMs = (missingCredits * 1000) / ratePerSecond;
	// The driver observes and refills tokens on the scheduled frame itself.
	return Math.max(0, availabilityDelayMs - EXPECTED_FRAME_INTERVAL_MS);
}

function schedulePendingPartition(
	partition: PreviewDomCommitPartition,
	policy: PreviewDomCommitPolicy,
): void {
	if (partition.pendingByTargetKey.size === 0) return;

	const delayMs =
		policy.mode === "scrolling"
			? SCROLLING_REEVALUATION_DELAY_MS
			: readTokenAvailabilityDelayMs(partition.tokenState, policy.ratePerSecond);
	schedulePartition(partition, delayMs, policy.mode === "scrolling");
}

function drainPartition(
	partition: PreviewDomCommitPartition,
	frameTimestamp: number,
): void {
	const scrolling = isScrollActivityActive();
	if (scrolling && hasPendingBrowserInput()) {
		schedulePartition(partition, SCROLLING_REEVALUATION_DELAY_MS, true);
		return;
	}

	const policy = scrolling
		? {
				...SCROLLING_POLICY,
				ratePerSecond: resolvePositiveRate(
					partition.getCommitsPerSecond(),
					DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
				),
			}
		: IDLE_POLICY;

	partition.tokenState = refillPreviewScheduleTokens(
		partition.tokenState,
		frameTimestamp,
		policy,
	);
	const deadline = readPreviewSchedulingTime() + policy.maxDrainCpuMs;
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
		drainedTasks < policy.maxTasksPerDrain &&
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

		if (scrolling && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("preview.domCommitDuringScroll");
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
	schedulePendingPartition(partition, policy);
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

		const partition = getOrCreatePartition(
			task.frameCoordinator,
			task.getCommitsPerSecond,
		);
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
