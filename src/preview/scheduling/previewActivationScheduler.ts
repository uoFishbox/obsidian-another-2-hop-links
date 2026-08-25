import { DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND } from "./previewSchedulingConfig";
import { isScrollActivityActive } from "shared/ui/scroll/scrollActivity";
import {
	readVirtualScrollMeasurementEpoch,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "cards/virtualization/public";
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
const MAX_OUTSTANDING_PREVIEW_JOBS = 3;

interface PreviewActivationPolicy {
	readonly mode: "idle" | "backpressured" | "scrolling";
	ratePerSecond: number;
	readonly creditCapacity: number;
	readonly initialCredits?: number;
	readonly maxTasksPerDrain: number;
	readonly maxDrainCpuMs: number;
}

const IDLE_POLICY: PreviewActivationPolicy = {
	mode: "idle",
	ratePerSecond: 120,
	creditCapacity: 2,
	maxTasksPerDrain: 2,
	maxDrainCpuMs: 2,
};
const BACKPRESSURED_POLICY: PreviewActivationPolicy = {
	mode: "backpressured",
	ratePerSecond: 30,
	creditCapacity: 2,
	maxTasksPerDrain: 1,
	maxDrainCpuMs: 1,
};
const SCROLLING_POLICY: PreviewActivationPolicy = {
	mode: "scrolling",
	ratePerSecond: DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
	creditCapacity: 4,
	initialCredits: 1,
	maxTasksPerDrain: 4,
	maxDrainCpuMs: 0.5,
};

export type PreviewBackpressureChangeListener = () => void;

export interface PreviewActivationHandle {
	readonly key: string;
	/** Cancels this activation request if it is still pending. */
	cancel(): void;
}

/** One virtual surface's independently scheduled activation queue. */
export interface PreviewActivationScope {
	request(key: string, onActivated?: () => void): PreviewActivationHandle;
	dispose(): void;
}

/** Scheduler-wide activation policy shared by every surface scope. */
export interface CreatePreviewActivationSchedulerOptions {
	readonly getOutstandingPreviewJobCount?: () => number;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureChangeListener,
	) => () => void;
	/** Maximum preview activations admitted per second while scrolling. */
	readonly getActivationsPerSecond?: () => number;
	/** Realm used only for token-delay timers and the scheduling clock. */
	readonly getWindow?: () => Window | null;
}

export interface CreatePreviewActivationScopeOptions {
	readonly frameCoordinator: VirtualFrameCoordinator;
}

/** Scheduler boundary owned by one PreviewRuntime. */
export interface PreviewActivationScheduler {
	createScope(options: CreatePreviewActivationScopeOptions): PreviewActivationScope;
	dispose(): void;
}

interface PreviewActivationScopeState {
	readonly queue: PreviewKeyedQueue<PreviewActivationRequest>;
	readonly driver: PreviewFrameDriver;
	lastObservedMeasurementEpoch: number;
	disposed: boolean;
}

interface PreviewActivationRequest {
	readonly schedulerState: PreviewActivationSchedulerState;
	readonly key: string;
	readonly scopeState: PreviewActivationScopeState;
	readonly onActivated: (() => void) | undefined;
	hasDeferredForVirtualScrollMeasurement: boolean;
	settled: boolean;
}

interface PreviewActivationSchedulerState {
	readonly scopes: Set<PreviewActivationScopeState>;
	readonly getOutstandingPreviewJobCount: () => number;
	readonly subscribeBackpressure:
		| ((listener: PreviewBackpressureChangeListener) => () => void)
		| undefined;
	readonly getActivationsPerSecond: () => number;
	readonly getWindow: (() => Window | null) | undefined;
	readonly scrollingPolicy: PreviewActivationPolicy;
	tokenState: PreviewScheduleTokenState;
	blockedForBackpressure: boolean;
	unsubscribeBackpressure: (() => void) | undefined;
	unsubscribeScrollActivity?: () => void;
	nextScopeId: number;
	disposed: boolean;
}

const ACTIVATION_REQUEST = Symbol("preview-activation-request");

interface PreviewActivationHandleInternal extends PreviewActivationHandle {
	[ACTIVATION_REQUEST]: PreviewActivationRequest | undefined;
}

/** Creates the scheduler facade used by PreviewRuntime. */
export function createPreviewActivationScheduler(
	options: CreatePreviewActivationSchedulerOptions = {},
): PreviewActivationScheduler {
	const state = createSchedulerState(options);
	return {
		createScope: (scopeOptions) =>
			createPreviewActivationScope(state, scopeOptions),
		dispose: () => disposeSchedulerState(state),
	};
}

function createSchedulerState(
	options: CreatePreviewActivationSchedulerOptions,
): PreviewActivationSchedulerState {
	return {
		scopes: new Set(),
		getOutstandingPreviewJobCount:
			options.getOutstandingPreviewJobCount ?? getEmptyOutstandingPreviewJobCount,
		subscribeBackpressure: options.subscribeBackpressure,
		getActivationsPerSecond:
			options.getActivationsPerSecond ?? getDefaultActivationsPerSecond,
		getWindow: options.getWindow,
		scrollingPolicy: { ...SCROLLING_POLICY },
		tokenState: createEmptyPreviewScheduleTokenState(),
		blockedForBackpressure: false,
		unsubscribeBackpressure: undefined,
		nextScopeId: 0,
		disposed: false,
	};
}

function getEmptyOutstandingPreviewJobCount(): number {
	return 0;
}

function getDefaultActivationsPerSecond(): number {
	return DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND;
}

function createActivationHandle(
	key: string,
	request: PreviewActivationRequest | undefined,
): PreviewActivationHandle {
	const handle: PreviewActivationHandleInternal = {
		key,
		[ACTIVATION_REQUEST]: request,
		cancel: cancelHandle,
	};
	return handle;
}

function cancelHandle(this: PreviewActivationHandleInternal): void {
	const request = this[ACTIVATION_REQUEST];
	if (request) settleRequest(request.schedulerState, request, false);
}

function invokeActivated(onActivated: (() => void) | undefined): void {
	try {
		onActivated?.();
	} catch (error) {
		console.error("Preview activation callback failed", error);
	}
}

function hasPendingScope(scopeState: PreviewActivationScopeState): boolean {
	return !scopeState.disposed && scopeState.queue.size > 0;
}

function hasAnyPendingScope(state: PreviewActivationSchedulerState): boolean {
	for (const scopeState of state.scopes) {
		if (hasPendingScope(scopeState)) return true;
	}
	return false;
}

function settleRequest(
	state: PreviewActivationSchedulerState,
	request: PreviewActivationRequest,
	activated: boolean,
): void {
	if (request.settled) return;
	request.settled = true;
	const scopeState = request.scopeState;
	scopeState.queue.delete(request.key, request);
	if (scopeState.queue.size === 0) {
		scopeState.queue.clear();
		scopeState.driver.cancel();
	}
	if (activated) invokeActivated(request.onActivated);
	if (!hasAnyPendingScope(state)) releaseBackpressureSubscription(state);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function ensureScrollActivitySubscription(
	state: PreviewActivationSchedulerState,
): void {
	ensurePreviewScrollActivitySubscription(state, (isActive) => {
		for (const scopeState of state.scopes) {
			scopeState.driver.cancel();
			scheduleScope(state, scopeState, 0, isActive);
		}
	});
}

function releaseScrollActivitySubscriptionIfIdle(
	state: PreviewActivationSchedulerState,
): void {
	releasePreviewScrollActivitySubscriptionIfIdle(state, hasAnyPendingScope(state));
}

function blockForBackpressure(state: PreviewActivationSchedulerState): void {
	state.blockedForBackpressure = true;
	ensureBackpressureSubscription(state);
}

function ensureBackpressureSubscription(state: PreviewActivationSchedulerState): void {
	if (state.unsubscribeBackpressure || !state.subscribeBackpressure) return;
	state.unsubscribeBackpressure = state.subscribeBackpressure(() => {
		if (!hasPreviewAdmissionCapacity(state.getOutstandingPreviewJobCount())) {
			state.blockedForBackpressure = true;
			return;
		}
		state.blockedForBackpressure = false;
		for (const scopeState of state.scopes) scheduleScope(state, scopeState);
	});
}

function releaseBackpressureSubscription(state: PreviewActivationSchedulerState): void {
	state.unsubscribeBackpressure?.();
	state.unsubscribeBackpressure = undefined;
	state.blockedForBackpressure = false;
}

function canSchedule(state: PreviewActivationSchedulerState): boolean {
	return !state.blockedForBackpressure || !state.subscribeBackpressure;
}

function scheduleScope(
	state: PreviewActivationSchedulerState,
	scopeState: PreviewActivationScopeState,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (
		!hasPendingScope(scopeState) ||
		scopeState.driver.isScheduled() ||
		!canSchedule(state)
	) {
		return;
	}
	scopeState.driver.schedule({
		lane: scrolling ? "post-paint" : "idle",
		delayMs,
	});
}

function resolveActivationPolicy(
	outstandingPreviewJobCount: number,
	scrolling: boolean,
): PreviewActivationPolicy {
	if (scrolling) return SCROLLING_POLICY;
	if (outstandingPreviewJobCount > 0) return BACKPRESSURED_POLICY;
	return IDLE_POLICY;
}

function hasPreviewAdmissionCapacity(outstandingPreviewJobCount: number): boolean {
	return outstandingPreviewJobCount < MAX_OUTSTANDING_PREVIEW_JOBS;
}

function drainScope(
	state: PreviewActivationSchedulerState,
	scopeState: PreviewActivationScopeState,
	frameTimestamp: number,
): void {
	if (!hasPendingScope(scopeState)) return;
	const scrolling = isScrollActivityActive();
	const shouldDeferUndeferredRequests =
		shouldDeferPreviewActivationForVirtualScrollMeasurement(
			scopeState.lastObservedMeasurementEpoch,
		);
	scopeState.lastObservedMeasurementEpoch = readVirtualScrollMeasurementEpoch();

	let outstandingPreviewJobCount = state.getOutstandingPreviewJobCount();
	let policy = resolveActivationPolicy(outstandingPreviewJobCount, scrolling);
	if (scrolling) {
		state.scrollingPolicy.ratePerSecond = resolvePositivePreviewRate(
			state.getActivationsPerSecond(),
			DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
		);
		policy = state.scrollingPolicy;
	}
	state.tokenState = refillPreviewScheduleTokens(
		state.tokenState,
		frameTimestamp,
		policy,
	);

	if (!hasPreviewAdmissionCapacity(outstandingPreviewJobCount)) {
		blockForBackpressure(state);
		if (!state.subscribeBackpressure)
			scheduleScope(state, scopeState, 0, scrolling);
		return;
	}
	state.blockedForBackpressure = false;

	const maxInspectableQueueEntries = Math.min(
		MAX_QUEUE_ENTRIES_PER_DRAIN,
		Math.max(0, scopeState.queue.queuedEntryCount),
	);
	const deadline = readPreviewSchedulingTime() + policy.maxDrainCpuMs;
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumePreviewScheduleToken(state.tokenState) &&
		drainedTasks < policy.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readPreviewSchedulingTime() <= deadline
	) {
		if (!hasPreviewAdmissionCapacity(outstandingPreviewJobCount)) {
			blockForBackpressure(state);
			break;
		}
		const request = scopeState.queue.dequeue();
		if (!request) break;
		inspectedQueueEntries += 1;
		if (request.settled) continue;
		if (scopeState.queue.get(request.key) !== request || scopeState.disposed)
			continue;
		if (
			shouldDeferUndeferredRequests &&
			!request.hasDeferredForVirtualScrollMeasurement
		) {
			request.hasDeferredForVirtualScrollMeasurement = true;
			scopeState.queue.enqueue(request.key, request);
			continue;
		}

		settleRequest(state, request, true);
		state.tokenState = consumePreviewScheduleToken(state.tokenState);
		drainedTasks += 1;
		outstandingPreviewJobCount = state.getOutstandingPreviewJobCount();
	}

	scopeState.queue.compact();
	if (state.blockedForBackpressure && state.subscribeBackpressure) return;
	if (!hasPendingScope(scopeState)) return;
	scheduleScope(
		state,
		scopeState,
		readPreviewTokenAvailabilityDelayMs(state.tokenState, policy.ratePerSecond),
		scrolling,
	);
}

function enqueuePreviewActivation(
	state: PreviewActivationSchedulerState,
	scopeState: PreviewActivationScopeState,
	key: string,
	onActivated: (() => void) | undefined,
): PreviewActivationHandle {
	if (state.disposed || scopeState.disposed) {
		return createActivationHandle(key, undefined);
	}
	const request: PreviewActivationRequest = {
		schedulerState: state,
		key,
		scopeState,
		onActivated,
		hasDeferredForVirtualScrollMeasurement: false,
		settled: false,
	};
	const existing = scopeState.queue.enqueue(key, request);
	if (existing) {
		settleRequest(state, existing, false);
		scopeState.queue.compact();
	}
	ensureScrollActivitySubscription(state);
	ensureBackpressureSubscription(state);
	scheduleScope(state, scopeState);
	return createActivationHandle(key, request);
}

function resetScopeQueue(
	state: PreviewActivationSchedulerState,
	scopeState: PreviewActivationScopeState,
): void {
	for (const request of Array.from(scopeState.queue.values())) {
		settleRequest(state, request, false);
	}
	scopeState.queue.clear();
}

function disposeScope(
	state: PreviewActivationSchedulerState,
	scopeState: PreviewActivationScopeState,
): void {
	if (scopeState.disposed) return;
	resetScopeQueue(state, scopeState);
	scopeState.disposed = true;
	scopeState.driver.dispose();
	state.scopes.delete(scopeState);
	if (state.scopes.size === 0) releaseBackpressureSubscription(state);
	releaseScrollActivitySubscriptionIfIdle(state);
}

function createPreviewActivationScope(
	state: PreviewActivationSchedulerState,
	options: CreatePreviewActivationScopeOptions,
): PreviewActivationScope {
	if (state.disposed) return DISABLED_PREVIEW_ACTIVATION_SCOPE;
	let scopeState: PreviewActivationScopeState;
	const driver = createPreviewFrameDriver({
		coordinator: options.frameCoordinator,
		taskKey: `preview:activation-drain:${++state.nextScopeId}`,
		getWindow: state.getWindow,
		onFrame: (timestamp) => drainScope(state, scopeState, timestamp),
	});
	scopeState = {
		queue: createPreviewKeyedQueue(),
		driver,
		lastObservedMeasurementEpoch: readVirtualScrollMeasurementEpoch(),
		disposed: false,
	};
	state.scopes.add(scopeState);
	return {
		request: (key, onActivated) =>
			enqueuePreviewActivation(state, scopeState, key, onActivated),
		dispose: () => disposeScope(state, scopeState),
	};
}

function disposeSchedulerState(state: PreviewActivationSchedulerState): void {
	if (state.disposed) return;
	state.disposed = true;
	for (const scopeState of Array.from(state.scopes)) disposeScope(state, scopeState);
	state.unsubscribeScrollActivity?.();
	state.unsubscribeScrollActivity = undefined;
}

const DISABLED_PREVIEW_ACTIVATION_SCOPE: PreviewActivationScope = {
	request: (key) => createActivationHandle(key, undefined),
	dispose: () => {},
};
