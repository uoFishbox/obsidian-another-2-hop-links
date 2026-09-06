import { DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND } from "./previewSchedulingConfig";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "shared/ui/scroll/scrollActivity";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";

const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;
const MAX_TOKEN_REFILL_ELAPSED_MS = 250;
const TOKEN_CREDIT_EPSILON = 1e-9;
const EXPECTED_PREVIEW_FRAME_INTERVAL_MS = 1000 / 60;
const SCROLLING_REEVALUATION_DELAY_MS = EXPECTED_PREVIEW_FRAME_INTERVAL_MS * 2;

type PreviewDomCommitPolicyMode = "idle" | "scrolling";
type PreviewDomCommitLane = "idle" | "post-paint";

interface PreviewDomCommitPolicy {
	readonly mode: PreviewDomCommitPolicyMode;
	readonly ratePerSecond: number;
	readonly creditCapacity: number;
	readonly initialCredits?: number;
	readonly maxTasksPerDrain: number;
	readonly maxDrainCpuMs: number;
}

const IDLE_POLICY: PreviewDomCommitPolicy = {
	mode: "idle",
	ratePerSecond: 480,
	creditCapacity: 8,
	maxTasksPerDrain: 8,
	maxDrainCpuMs: 3,
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
	readonly coordinator: VirtualFrameCoordinator;
	readonly taskKey: string;
	readonly getCommitsPerSecond: () => number;
	readonly pendingByKey: Map<string, QueuedPreviewDomCommitTask>;
	queueEntries: QueuedPreviewDomCommitTask[];
	queueHead: number;
	delayHandle: number | null;
	delayWindow: Window | null;
	scheduledLane: PreviewDomCommitLane | null;
	availableCredits: number;
	lastRefillTimestamp: number | null;
	policyMode: PreviewDomCommitPolicyMode | null;
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

function readPreviewSchedulingTime(ownerWindow?: Window | null): number {
	if (typeof ownerWindow?.performance?.now === "function") {
		return ownerWindow.performance.now();
	}
	if (typeof globalThis.performance?.now === "function") {
		return globalThis.performance.now();
	}
	return Date.now();
}

function resolvePositivePreviewRate(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasAnyPendingTask(state: PreviewDomCommitSchedulerState): boolean {
	for (const scopeState of state.scopes) {
		if (!scopeState.disposed && scopeState.pendingByKey.size > 0) return true;
	}
	return false;
}

function releaseScrollActivitySubscriptionIfIdle(
	state: PreviewDomCommitSchedulerState,
): void {
	if (hasAnyPendingTask(state)) return;
	state.unsubscribeScrollActivity?.();
	state.unsubscribeScrollActivity = undefined;
}

function clearQueue(scopeState: PreviewDomCommitScopeState): void {
	scopeState.pendingByKey.clear();
	scopeState.queueEntries.length = 0;
	scopeState.queueHead = 0;
}

function compactQueue(scopeState: PreviewDomCommitScopeState): void {
	if (
		scopeState.queueHead < 64 &&
		scopeState.queueEntries.length <= scopeState.pendingByKey.size * 2 + 16
	) {
		return;
	}
	scopeState.queueEntries = scopeState.queueEntries
		.slice(scopeState.queueHead)
		.filter((task) => scopeState.pendingByKey.get(task.targetKey) === task);
	scopeState.queueHead = 0;
}

function dequeueTask(
	scopeState: PreviewDomCommitScopeState,
): QueuedPreviewDomCommitTask | undefined {
	if (scopeState.queueHead >= scopeState.queueEntries.length) return undefined;
	const task = scopeState.queueEntries[scopeState.queueHead];
	scopeState.queueHead += 1;
	return task;
}

function cancelScopeSchedule(scopeState: PreviewDomCommitScopeState): void {
	if (scopeState.scheduledLane !== null) {
		scopeState.coordinator.cancel(scopeState.scheduledLane, scopeState.taskKey);
		scopeState.scheduledLane = null;
	}
	if (scopeState.delayHandle === null) return;
	if (scopeState.delayWindow) {
		scopeState.delayWindow.clearTimeout(scopeState.delayHandle);
	} else {
		globalThis.clearTimeout(scopeState.delayHandle);
	}
	scopeState.delayHandle = null;
	scopeState.delayWindow = null;
}

function isScopeScheduled(scopeState: PreviewDomCommitScopeState): boolean {
	return scopeState.delayHandle !== null || scopeState.scheduledLane !== null;
}

function resolveSchedulingWindow(state: PreviewDomCommitSchedulerState): Window | null {
	return state.getWindow?.() ?? (typeof window === "undefined" ? null : window);
}

function scheduleOnCoordinator(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	lane: PreviewDomCommitLane,
): void {
	if (scopeState.disposed) return;
	const scheduled = scopeState.coordinator.schedule(lane, scopeState.taskKey, () => {
		scopeState.scheduledLane = null;
		if (scopeState.disposed) return;
		drainScope(
			state,
			scopeState,
			readPreviewSchedulingTime(resolveSchedulingWindow(state)),
		);
	});
	if (scheduled) scopeState.scheduledLane = lane;
}

function scheduleScope(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (
		scopeState.disposed ||
		scopeState.pendingByKey.size === 0 ||
		isScopeScheduled(scopeState)
	) {
		return;
	}

	const lane: PreviewDomCommitLane = scrolling ? "post-paint" : "idle";
	const normalizedDelayMs = Math.max(0, delayMs);
	if (normalizedDelayMs === 0) {
		scheduleOnCoordinator(state, scopeState, lane);
		return;
	}

	const ownerWindow = resolveSchedulingWindow(state);
	const onDelayElapsed = (): void => {
		scopeState.delayHandle = null;
		scopeState.delayWindow = null;
		scheduleOnCoordinator(state, scopeState, lane);
	};
	scopeState.delayWindow = ownerWindow;
	scopeState.delayHandle = ownerWindow
		? ownerWindow.setTimeout(onDelayElapsed, normalizedDelayMs)
		: (globalThis.setTimeout(
				onDelayElapsed,
				normalizedDelayMs,
			) as unknown as number);
}

function settleTask(
	state: PreviewDomCommitSchedulerState,
	task: QueuedPreviewDomCommitTask,
	result: PreviewDomCommitResult,
): void {
	if (task.settled) return;
	task.settled = true;
	const scopeState = task.scopeState;
	if (scopeState.pendingByKey.get(task.targetKey) === task) {
		scopeState.pendingByKey.delete(task.targetKey);
	}
	if (scopeState.pendingByKey.size === 0) {
		clearQueue(scopeState);
		cancelScopeSchedule(scopeState);
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
	if (scopeState.pendingByKey.get(task.targetKey) === task) {
		scopeState.pendingByKey.delete(task.targetKey);
	}
	if (scopeState.pendingByKey.size === 0) {
		clearQueue(scopeState);
		cancelScopeSchedule(scopeState);
	}
	task.reject(error);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function ensureScrollActivitySubscription(state: PreviewDomCommitSchedulerState): void {
	if (state.unsubscribeScrollActivity) return;
	state.unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		for (const scopeState of state.scopes) {
			cancelScopeSchedule(scopeState);
			scheduleScope(state, scopeState, 0, isActive);
		}
	});
}

function refillTokens(
	scopeState: PreviewDomCommitScopeState,
	timestamp: number,
	policy: PreviewDomCommitPolicy,
	ratePerSecond: number,
): void {
	if (scopeState.lastRefillTimestamp === null) {
		scopeState.availableCredits = Math.min(
			policy.creditCapacity,
			Math.max(0, policy.initialCredits ?? policy.creditCapacity),
		);
		scopeState.lastRefillTimestamp = timestamp;
		scopeState.policyMode = policy.mode;
		return;
	}

	const enteredScrolling =
		scopeState.policyMode !== null &&
		scopeState.policyMode !== "scrolling" &&
		policy.mode === "scrolling";
	if (enteredScrolling) {
		scopeState.availableCredits = Math.min(
			scopeState.availableCredits,
			policy.initialCredits ?? 1,
		);
		scopeState.lastRefillTimestamp = timestamp;
	}
	const elapsedMs = Math.min(
		MAX_TOKEN_REFILL_ELAPSED_MS,
		Math.max(0, timestamp - scopeState.lastRefillTimestamp),
	);
	scopeState.availableCredits = Math.min(
		policy.creditCapacity,
		scopeState.availableCredits + (elapsedMs * ratePerSecond) / 1000,
	);
	scopeState.lastRefillTimestamp = timestamp;
	scopeState.policyMode = policy.mode;
}

function canConsumeToken(scopeState: PreviewDomCommitScopeState): boolean {
	return scopeState.availableCredits + TOKEN_CREDIT_EPSILON >= 1;
}

function readTokenAvailabilityDelayMs(
	scopeState: PreviewDomCommitScopeState,
	ratePerSecond: number,
): number {
	if (canConsumeToken(scopeState)) return 0;
	if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
		return MAX_TOKEN_REFILL_ELAPSED_MS;
	}
	const missingCredits = Math.max(0, 1 - scopeState.availableCredits);
	const availabilityDelayMs = (missingCredits * 1000) / ratePerSecond;
	return Math.min(
		MAX_TOKEN_REFILL_ELAPSED_MS,
		Math.max(0, availabilityDelayMs - EXPECTED_PREVIEW_FRAME_INTERVAL_MS),
	);
}

function schedulePendingScope(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	policy: PreviewDomCommitPolicy,
	ratePerSecond: number,
): void {
	if (scopeState.pendingByKey.size === 0) return;
	const tokenAvailabilityDelayMs = readTokenAvailabilityDelayMs(
		scopeState,
		ratePerSecond,
	);
	const delayMs =
		policy.mode === "scrolling"
			? Math.max(SCROLLING_REEVALUATION_DELAY_MS, tokenAvailabilityDelayMs)
			: tokenAvailabilityDelayMs;
	scheduleScope(state, scopeState, delayMs, policy.mode === "scrolling");
}

function drainScope(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
	frameTimestamp: number,
): void {
	if (scopeState.disposed) return;
	const scrolling = isScrollActivityActive();
	const policy = scrolling ? SCROLLING_POLICY : IDLE_POLICY;
	const ratePerSecond = scrolling
		? resolvePositivePreviewRate(
				scopeState.getCommitsPerSecond(),
				DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
			)
		: policy.ratePerSecond;

	refillTokens(scopeState, frameTimestamp, policy, ratePerSecond);
	const deadline = readPreviewSchedulingTime() + policy.maxDrainCpuMs;
	const maxInspectableQueueEntries = Math.min(
		MAX_QUEUE_ENTRIES_PER_DRAIN,
		Math.max(0, scopeState.queueEntries.length - scopeState.queueHead),
	);
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumeToken(scopeState) &&
		drainedTasks < policy.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readPreviewSchedulingTime() <= deadline
	) {
		const task = dequeueTask(scopeState);
		if (!task) break;
		inspectedQueueEntries += 1;
		if (task.settled) continue;
		if (scopeState.pendingByKey.get(task.targetKey) !== task) continue;

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
				scopeState.availableCredits = Math.max(
					0,
					scopeState.availableCredits - 1,
				);
			}
		} catch (error) {
			rejectTask(state, task, error);
		}
	}

	compactQueue(scopeState);
	schedulePendingScope(state, scopeState, policy, ratePerSecond);
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
		const existingTask = scopeState.pendingByKey.get(task.targetKey);
		scopeState.pendingByKey.set(task.targetKey, queuedTask);
		scopeState.queueEntries.push(queuedTask);
		if (existingTask) {
			settleTask(state, existingTask, {
				type: "skipped",
				reason: "replaced",
			});
			compactQueue(scopeState);
		}
		ensureScrollActivitySubscription(state);
		scheduleScope(state, scopeState);
	});
}

function disposeScope(
	state: PreviewDomCommitSchedulerState,
	scopeState: PreviewDomCommitScopeState,
): void {
	if (scopeState.disposed) return;
	for (const task of Array.from(scopeState.pendingByKey.values())) {
		settleTask(state, task, { type: "skipped", reason: "disposed" });
	}
	clearQueue(scopeState);
	scopeState.disposed = true;
	cancelScopeSchedule(scopeState);
	scopeState.availableCredits = 0;
	scopeState.lastRefillTimestamp = null;
	scopeState.policyMode = null;
	state.scopes.delete(scopeState);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function createPreviewDomCommitScope(
	state: PreviewDomCommitSchedulerState,
	options: CreatePreviewDomCommitScopeOptions,
): PreviewDomCommitScope {
	if (state.disposed) return DISABLED_PREVIEW_DOM_COMMIT_SCOPE;
	const scopeState: PreviewDomCommitScopeState = {
		coordinator: options.frameCoordinator,
		taskKey: `preview:dom-commit-drain:${++state.nextScopeId}`,
		getCommitsPerSecond: options.getCommitsPerSecond ?? getDefaultCommitsPerSecond,
		pendingByKey: new Map(),
		queueEntries: [],
		queueHead: 0,
		delayHandle: null,
		delayWindow: null,
		scheduledLane: null,
		availableCredits: 0,
		lastRefillTimestamp: null,
		policyMode: null,
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
