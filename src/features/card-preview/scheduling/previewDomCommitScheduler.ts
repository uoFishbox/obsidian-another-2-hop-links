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
import { createPreviewKeyedQueue, type PreviewKeyedQueue } from "./previewKeyedQueue";

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
}

export type PreviewDomCommitResult =
	| { readonly type: "committed" }
	| {
			readonly type: "skipped";
			readonly reason: "replaced" | "stale" | "no-op" | "disposed";
	  };

export interface CreatePreviewDomCommitScopeOptions {
	readonly frameCoordinator?: VirtualFrameCoordinator;
	/** Resolves the maximum DOM commits per second while scrolling. */
	readonly getCommitsPerSecond?: () => number;
}

/** Scheduler boundary owned by one PreviewRuntime. */
export interface PreviewDomCommitScheduler {
	createScope(options?: CreatePreviewDomCommitScopeOptions): PreviewDomCommitScope;
	dispose(): void;
}

/** One surface's slice of the DOM commit scheduler. */
export interface PreviewDomCommitScope {
	schedule(task: PreviewDomCommitTask): Promise<PreviewDomCommitResult>;
	dispose(): void;
}

interface PreviewDomCommitScopeState {
	readonly partition: PreviewDomCommitPartition;
	disposed: boolean;
}

interface QueuedPreviewDomCommitTask extends PreviewDomCommitTask {
	readonly scopeState: PreviewDomCommitScopeState;
	readonly resolve: (result: PreviewDomCommitResult) => void;
	readonly reject: (error: unknown) => void;
	settled: boolean;
}

interface PreviewDomCommitPartition {
	readonly coordinator: VirtualFrameCoordinator | undefined;
	readonly driver: PreviewFrameDriver;
	readonly queue: PreviewKeyedQueue<QueuedPreviewDomCommitTask>;
	readonly scopes: Set<PreviewDomCommitScopeState>;
	readonly getCommitsPerSecond: () => number;
	tokenState: PreviewScheduleTokenState;
}

interface PreviewDomCommitSchedulerState {
	readonly fallbackPartitionIdentity: object;
	readonly pendingByTargetKey: Map<string, QueuedPreviewDomCommitTask>;
	readonly partitionsByIdentity: Map<object, PreviewDomCommitPartition>;
	nextPartitionId: number;
	unsubscribeScrollActivity?: () => void;
	disposed: boolean;
}

function createSchedulerState(): PreviewDomCommitSchedulerState {
	return {
		fallbackPartitionIdentity: {},
		pendingByTargetKey: new Map(),
		partitionsByIdentity: new Map(),
		nextPartitionId: 0,
		disposed: false,
	};
}

function getDefaultCommitsPerSecond(): number {
	return DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND;
}

function resolvePositiveRate(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getOrCreatePartition(
	state: PreviewDomCommitSchedulerState,
	coordinator: VirtualFrameCoordinator | undefined,
	getCommitsPerSecond: (() => number) | undefined,
): PreviewDomCommitPartition {
	const identity = coordinator ?? state.fallbackPartitionIdentity;
	const existing = state.partitionsByIdentity.get(identity);
	if (existing) return existing;

	let partition: PreviewDomCommitPartition;
	const driver = createPreviewFrameDriver({
		coordinator,
		taskKey: `preview:dom-commit-drain:${++state.nextPartitionId}`,
		onAnimationFrameScheduled: () => {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.domCommitScheduler.animationFrame");
			}
		},
		onFrame: (timestamp) => drainPartition(state, partition, timestamp),
	});
	partition = {
		coordinator,
		driver,
		queue: createPreviewKeyedQueue(),
		scopes: new Set(),
		getCommitsPerSecond: getCommitsPerSecond ?? getDefaultCommitsPerSecond,
		tokenState: createEmptyPreviewScheduleTokenState(),
	};
	state.partitionsByIdentity.set(identity, partition);
	return partition;
}

function settleTask(
	state: PreviewDomCommitSchedulerState,
	task: QueuedPreviewDomCommitTask,
	result: PreviewDomCommitResult,
): void {
	if (task.settled) return;

	task.settled = true;
	if (state.pendingByTargetKey.get(task.targetKey) === task) {
		state.pendingByTargetKey.delete(task.targetKey);
	}
	task.scopeState.partition.queue.delete(task.targetKey, task);
	task.resolve(result);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function rejectTask(
	state: PreviewDomCommitSchedulerState,
	task: QueuedPreviewDomCommitTask,
	error: unknown,
): void {
	if (task.settled) return;

	task.settled = true;
	if (state.pendingByTargetKey.get(task.targetKey) === task) {
		state.pendingByTargetKey.delete(task.targetKey);
	}
	task.scopeState.partition.queue.delete(task.targetKey, task);
	task.reject(error);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function compactQueue(partition: PreviewDomCommitPartition): void {
	partition.queue.compact();
}

function readNextQueuedTask(
	partition: PreviewDomCommitPartition,
): QueuedPreviewDomCommitTask | undefined {
	return partition.queue.dequeue();
}

function ensureScrollActivitySubscription(state: PreviewDomCommitSchedulerState): void {
	if (state.unsubscribeScrollActivity) return;

	state.unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		for (const partition of state.partitionsByIdentity.values()) {
			partition.driver.cancel();
			schedulePartition(state, partition, 0, isActive);
		}
	});
}

function releaseScrollActivitySubscriptionIfIdle(
	state: PreviewDomCommitSchedulerState,
): void {
	if (state.pendingByTargetKey.size > 0) return;
	state.unsubscribeScrollActivity?.();
	state.unsubscribeScrollActivity = undefined;
}

function schedulePartition(
	_state: PreviewDomCommitSchedulerState,
	partition: PreviewDomCommitPartition,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (partition.queue.size === 0 || partition.driver.isScheduled()) {
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
	state: PreviewDomCommitSchedulerState,
	partition: PreviewDomCommitPartition,
	policy: PreviewDomCommitPolicy,
): void {
	if (partition.queue.size === 0) return;

	const delayMs =
		policy.mode === "scrolling"
			? SCROLLING_REEVALUATION_DELAY_MS
			: readTokenAvailabilityDelayMs(partition.tokenState, policy.ratePerSecond);
	schedulePartition(state, partition, delayMs, policy.mode === "scrolling");
}

function drainPartition(
	state: PreviewDomCommitSchedulerState,
	partition: PreviewDomCommitPartition,
	frameTimestamp: number,
): void {
	const scrolling = isScrollActivityActive();
	if (scrolling && hasPendingBrowserInput()) {
		schedulePartition(state, partition, SCROLLING_REEVALUATION_DELAY_MS, true);
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
		partition.queue.queuedEntryCount,
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
		if (partition.queue.get(task.targetKey) !== task) continue;

		if (task.isStale()) {
			settleTask(state, task, { type: "skipped", reason: "stale" });
			continue;
		}

		if (scrolling && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("preview.domCommitDuringScroll");
		}

		drainedTasks += 1;
		try {
			const didCommit = task.commit();
			settleTask(
				state,
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
			rejectTask(state, task, error);
		}
	}

	compactQueue(partition);
	schedulePendingPartition(state, partition, policy);
}

/**
 * Queues a live preview DOM replacement and coalesces older work by target.
 */
function enqueuePreviewDomCommitForState(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	task: PreviewDomCommitTask,
): Promise<PreviewDomCommitResult> {
	if (state.disposed || scopeState.disposed) {
		return Promise.resolve({ type: "skipped", reason: "disposed" });
	}
	return new Promise<PreviewDomCommitResult>((resolve, reject) => {
		const existingTask = state.pendingByTargetKey.get(task.targetKey);
		if (existingTask) {
			settleTask(state, existingTask, {
				type: "skipped",
				reason: "replaced",
			});
			compactQueue(existingTask.scopeState.partition);
		}

		const partition = scopeState.partition;
		const queuedTask: QueuedPreviewDomCommitTask = {
			...task,
			scopeState,
			resolve,
			reject,
			settled: false,
		};
		state.pendingByTargetKey.set(task.targetKey, queuedTask);
		partition.queue.enqueue(task.targetKey, queuedTask);
		ensureScrollActivitySubscription(state);
		schedulePartition(state, partition);
	});
}

/**
 * Releases one surface scope: settles every pending commit it owns and removes
 * the partition once no scope references it anymore.
 */
function disposePreviewDomCommitScopeForState(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
): void {
	if (scopeState.disposed) return;
	scopeState.disposed = true;

	for (const task of Array.from(state.pendingByTargetKey.values())) {
		if (task.scopeState === scopeState) {
			settleTask(state, task, { type: "skipped", reason: "disposed" });
		}
	}

	scopeState.partition.scopes.delete(scopeState);
	if (scopeState.partition.scopes.size === 0) {
		scopeState.partition.driver.dispose();
		state.partitionsByIdentity.delete(
			scopeState.partition.coordinator ?? state.fallbackPartitionIdentity,
		);
	}
	releaseScrollActivitySubscriptionIfIdle(state);
}

function createPreviewDomCommitScopeForState(
	state: PreviewDomCommitSchedulerState,
	options: CreatePreviewDomCommitScopeOptions = {},
): PreviewDomCommitScope {
	if (state.disposed) {
		return {
			schedule: () => Promise.resolve({ type: "skipped", reason: "disposed" }),
			dispose: () => {},
		};
	}

	const partition = getOrCreatePartition(
		state,
		options.frameCoordinator,
		options.getCommitsPerSecond,
	);
	const scopeState: PreviewDomCommitScopeState = { partition, disposed: false };
	const scope: PreviewDomCommitScope = {
		schedule: (task) => enqueuePreviewDomCommitForState(state, scopeState, task),
		dispose: () => disposePreviewDomCommitScopeForState(state, scopeState),
	};
	partition.scopes.add(scopeState);
	return scope;
}

function disposeSchedulerState(state: PreviewDomCommitSchedulerState): void {
	if (state.disposed) return;
	state.disposed = true;
	for (const partition of Array.from(state.partitionsByIdentity.values())) {
		for (const scopeState of Array.from(partition.scopes)) {
			disposePreviewDomCommitScopeForState(state, scopeState);
		}
	}
	for (const partition of state.partitionsByIdentity.values()) {
		partition.queue.clear();
		partition.tokenState = createEmptyPreviewScheduleTokenState();
		partition.driver.dispose();
	}
	state.partitionsByIdentity.clear();
	state.unsubscribeScrollActivity?.();
	state.unsubscribeScrollActivity = undefined;
}

/** Creates an isolated scheduler owned by one PreviewRuntime. */
export function createPreviewDomCommitScheduler(): PreviewDomCommitScheduler {
	const state = createSchedulerState();
	return {
		createScope: (options) => createPreviewDomCommitScopeForState(state, options),
		dispose: () => disposeSchedulerState(state),
	};
}
