import { DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND } from "./previewSchedulingConfig";
import { isScrollActivityActive } from "shared/ui/scroll/scrollActivity";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import {
	canConsumePreviewScheduleToken,
	consumePreviewScheduleToken,
	createEmptyPreviewScheduleTokenState,
	refillPreviewScheduleTokens,
	type PreviewScheduleTokenState,
} from "./previewScheduleTokenBucket";
import { createPreviewKeyedQueue, type PreviewKeyedQueue } from "./previewKeyedQueue";
import {
	createPreviewFrameDriver,
	type PreviewFrameDriver,
} from "./previewFrameDriver";
import {
	ensurePreviewScrollActivitySubscription,
	readPreviewSchedulingTime,
	readPreviewTokenAvailabilityDelayMs,
	releasePreviewScrollActivitySubscriptionIfIdle,
	resolvePositivePreviewRate,
} from "./previewSchedulerCore";

const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;
const SCROLLING_REEVALUATION_DELAY_MS = (1000 / 60) * 2;

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
	readonly frameCoordinator: VirtualFrameCoordinator;
	/** Resolves the maximum DOM commits per second while scrolling. */
	readonly getCommitsPerSecond?: () => number;
}

/** Scheduler boundary owned by one PreviewRuntime. */
export interface PreviewDomCommitScheduler {
	createScope(options: CreatePreviewDomCommitScopeOptions): PreviewDomCommitScope;
	dispose(): void;
}

/** One surface's independently scheduled DOM commit queue. */
export interface PreviewDomCommitScope {
	schedule(task: PreviewDomCommitTask): Promise<PreviewDomCommitResult>;
	dispose(): void;
}

interface PreviewDomCommitScopeState {
	readonly queue: PreviewKeyedQueue<QueuedPreviewDomCommitTask>;
	readonly driver: PreviewFrameDriver;
	readonly getCommitsPerSecond: () => number;
	tokenState: PreviewScheduleTokenState;
	disposed: boolean;
}

interface QueuedPreviewDomCommitTask extends PreviewDomCommitTask {
	readonly scopeState: PreviewDomCommitScopeState;
	readonly resolve: (result: PreviewDomCommitResult) => void;
	readonly reject: (error: unknown) => void;
	settled: boolean;
}

interface PreviewDomCommitSchedulerState {
	readonly getWindow: (() => Window | null) | undefined;
	readonly scopes: Set<PreviewDomCommitScopeState>;
	unsubscribeScrollActivity?: () => void;
	nextScopeId: number;
	disposed: boolean;
}

/** Creates an isolated scheduler owned by one PreviewRuntime. */
export function createPreviewDomCommitScheduler(
	getWindow?: () => Window | null,
): PreviewDomCommitScheduler {
	const state: PreviewDomCommitSchedulerState = {
		getWindow,
		scopes: new Set(),
		nextScopeId: 0,
		disposed: false,
	};
	return {
		createScope: (options) => createPreviewDomCommitScope(state, options),
		dispose: () => disposeSchedulerState(state),
	};
}

function getDefaultCommitsPerSecond(): number {
	return DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND;
}

function hasAnyPendingTask(state: PreviewDomCommitSchedulerState): boolean {
	for (const scopeState of state.scopes) {
		if (!scopeState.disposed && scopeState.queue.size > 0) return true;
	}
	return false;
}

function releaseScrollActivitySubscriptionIfIdle(
	state: PreviewDomCommitSchedulerState,
): void {
	releasePreviewScrollActivitySubscriptionIfIdle(state, hasAnyPendingTask(state));
}

function settleTask(
	state: PreviewDomCommitSchedulerState,
	task: QueuedPreviewDomCommitTask,
	result: PreviewDomCommitResult,
): void {
	if (task.settled) return;
	task.settled = true;
	const scopeState = task.scopeState;
	scopeState.queue.delete(task.targetKey, task);
	if (scopeState.queue.size === 0) {
		scopeState.queue.clear();
		scopeState.driver.cancel();
	}
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
	const scopeState = task.scopeState;
	scopeState.queue.delete(task.targetKey, task);
	if (scopeState.queue.size === 0) {
		scopeState.queue.clear();
		scopeState.driver.cancel();
	}
	task.reject(error);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function ensureScrollActivitySubscription(state: PreviewDomCommitSchedulerState): void {
	ensurePreviewScrollActivitySubscription(state, (isActive) => {
		for (const scopeState of state.scopes) {
			scopeState.driver.cancel();
			scheduleScope(scopeState, 0, isActive);
		}
	});
}

function scheduleScope(
	scopeState: PreviewDomCommitScopeState,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (
		scopeState.disposed ||
		scopeState.queue.size === 0 ||
		scopeState.driver.isScheduled()
	) {
		return;
	}
	scopeState.driver.schedule({
		lane: scrolling ? "post-paint" : "idle",
		delayMs,
	});
}

function schedulePendingScope(
	scopeState: PreviewDomCommitScopeState,
	policy: PreviewDomCommitPolicy,
): void {
	if (scopeState.queue.size === 0) return;
	const tokenAvailabilityDelayMs = readPreviewTokenAvailabilityDelayMs(
		scopeState.tokenState,
		policy.ratePerSecond,
	);
	const delayMs =
		policy.mode === "scrolling"
			? Math.max(SCROLLING_REEVALUATION_DELAY_MS, tokenAvailabilityDelayMs)
			: tokenAvailabilityDelayMs;
	scheduleScope(scopeState, delayMs, policy.mode === "scrolling");
}

function drainScope(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	frameTimestamp: number,
): void {
	if (scopeState.disposed) return;
	const scrolling = isScrollActivityActive();
	const policy = scrolling
		? {
				...SCROLLING_POLICY,
				ratePerSecond: resolvePositivePreviewRate(
					scopeState.getCommitsPerSecond(),
					DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
				),
			}
		: IDLE_POLICY;

	scopeState.tokenState = refillPreviewScheduleTokens(
		scopeState.tokenState,
		frameTimestamp,
		policy,
	);
	const deadline = readPreviewSchedulingTime() + policy.maxDrainCpuMs;
	const maxInspectableQueueEntries = Math.min(
		MAX_QUEUE_ENTRIES_PER_DRAIN,
		Math.max(0, scopeState.queue.queuedEntryCount),
	);
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumePreviewScheduleToken(scopeState.tokenState) &&
		drainedTasks < policy.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readPreviewSchedulingTime() <= deadline
	) {
		const task = scopeState.queue.dequeue();
		if (!task) break;
		inspectedQueueEntries += 1;
		if (task.settled) continue;
		if (scopeState.queue.get(task.targetKey) !== task) continue;

		if (task.isStale()) {
			settleTask(state, task, { type: "skipped", reason: "stale" });
			continue;
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
				scopeState.tokenState = consumePreviewScheduleToken(
					scopeState.tokenState,
				);
			}
		} catch (error) {
			rejectTask(state, task, error);
		}
	}

	scopeState.queue.compact();
	schedulePendingScope(scopeState, policy);
}

function enqueuePreviewDomCommit(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	task: PreviewDomCommitTask,
): Promise<PreviewDomCommitResult> {
	if (state.disposed || scopeState.disposed) {
		return Promise.resolve({ type: "skipped", reason: "disposed" });
	}
	return new Promise<PreviewDomCommitResult>((resolve, reject) => {
		const queuedTask: QueuedPreviewDomCommitTask = {
			...task,
			scopeState,
			resolve,
			reject,
			settled: false,
		};
		const existingTask = scopeState.queue.enqueue(task.targetKey, queuedTask);
		if (existingTask) {
			settleTask(state, existingTask, {
				type: "skipped",
				reason: "replaced",
			});
			scopeState.queue.compact();
		}
		ensureScrollActivitySubscription(state);
		scheduleScope(scopeState);
	});
}

function disposeScope(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
): void {
	if (scopeState.disposed) return;
	for (const task of Array.from(scopeState.queue.values())) {
		settleTask(state, task, { type: "skipped", reason: "disposed" });
	}
	scopeState.queue.clear();
	scopeState.disposed = true;
	scopeState.driver.dispose();
	scopeState.tokenState = createEmptyPreviewScheduleTokenState();
	state.scopes.delete(scopeState);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function createPreviewDomCommitScope(
	state: PreviewDomCommitSchedulerState,
	options: CreatePreviewDomCommitScopeOptions,
): PreviewDomCommitScope {
	if (state.disposed) return DISABLED_PREVIEW_DOM_COMMIT_SCOPE;
	let scopeState: PreviewDomCommitScopeState;
	const driver = createPreviewFrameDriver({
		coordinator: options.frameCoordinator,
		taskKey: `preview:dom-commit-drain:${++state.nextScopeId}`,
		getWindow: state.getWindow,
		onFrame: (timestamp) => drainScope(state, scopeState, timestamp),
	});
	scopeState = {
		queue: createPreviewKeyedQueue(),
		driver,
		getCommitsPerSecond: options.getCommitsPerSecond ?? getDefaultCommitsPerSecond,
		tokenState: createEmptyPreviewScheduleTokenState(),
		disposed: false,
	};
	state.scopes.add(scopeState);
	return {
		schedule: (task) => enqueuePreviewDomCommit(state, scopeState, task),
		dispose: () => disposeScope(state, scopeState),
	};
}

function disposeSchedulerState(state: PreviewDomCommitSchedulerState): void {
	if (state.disposed) return;
	state.disposed = true;
	for (const scopeState of Array.from(state.scopes)) disposeScope(state, scopeState);
	state.unsubscribeScrollActivity?.();
	state.unsubscribeScrollActivity = undefined;
}

const DISABLED_PREVIEW_DOM_COMMIT_SCOPE: PreviewDomCommitScope = {
	schedule: () => Promise.resolve({ type: "skipped", reason: "disposed" }),
	dispose: () => {},
};
