import { DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND } from "../../../appConstants";
import { isScrollActivityActive } from "ui/shared/scroll/scrollActivity";
import {
	readVirtualScrollMeasurementEpoch,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "ui/virtualization/public";
import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";
import {
	canConsumePreviewScheduleToken,
	consumePreviewScheduleToken,
	createEmptyPreviewScheduleTokenState,
	refillPreviewScheduleTokens,
	type PreviewScheduleTokenState,
} from "./previewScheduleTokenBucket";
import { createPreviewKeyedQueue, type PreviewKeyedQueue } from "./previewKeyedQueue";
import {
	ensurePreviewScrollActivitySubscription,
	createPreviewSchedulerPartitionRegistry,
	getOrCreatePreviewSchedulerPartition,
	readPreviewSchedulingTime,
	readPreviewTokenAvailabilityDelayMs,
	releasePreviewScrollActivitySubscriptionIfIdle,
	resolvePositivePreviewRate,
	type PreviewSchedulerPartitionBase,
	type PreviewSchedulerPartitionRegistry,
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

export interface PreviewActivationScope {
	readonly kind: "preview-activation-scope";
}

interface PreviewActivationScopeState {
	readonly scope: PreviewActivationScope;
	readonly partition: PreviewActivationPartition;
	readonly queue: PreviewKeyedQueue<PreviewActivationRequest>;
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

interface PreviewActivationPartition extends PreviewSchedulerPartitionBase {
	readonly scopes: Set<PreviewActivationScopeState>;
	readonly pendingScopesScratch: PreviewActivationScopeState[];
	lastObservedMeasurementEpoch: number;
}

/**
 * Scheduler-wide activation policy shared by every scope of one scheduler.
 *
 * The plugin runtime configures these once per PreviewService; surfaces must
 * not override them per scope.
 */
export interface CreatePreviewActivationSchedulerOptions {
	readonly getOutstandingPreviewJobCount?: () => number;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureChangeListener,
	) => () => void;
	/** Maximum preview activations admitted per second while scrolling. */
	readonly getActivationsPerSecond?: () => number;
	/** Realm used when a delayed frame cannot be scheduled directly by a coordinator. */
	readonly getWindow?: () => Window | null;
}

export interface CreatePreviewActivationScopeOptions {
	readonly frameCoordinator?: VirtualFrameCoordinator;
}

export interface PreviewActivationHandle {
	readonly key: string;
	/** Cancels this activation request if it is still pending. */
	cancel(): void;
}

/** Scheduler boundary owned by one PreviewRuntime. */
export interface PreviewActivationScheduler {
	createScope(options?: CreatePreviewActivationScopeOptions): PreviewActivationScope;
	request(
		key: string,
		scope: PreviewActivationScope,
		onActivated?: () => void,
	): PreviewActivationHandle;
	disposeScope(scope: PreviewActivationScope): void;
	dispose(): void;
}

/** Creates the scheduler facade used by PreviewRuntime. */
export function createPreviewActivationScheduler(
	options: CreatePreviewActivationSchedulerOptions = {},
): PreviewActivationScheduler {
	const state = createSchedulerState(options);
	return {
		createScope: (options) => createPreviewActivationScopeForState(state, options),
		request: (key, scope, onActivated) =>
			requestQueuedPreviewActivationForState(state, key, scope, onActivated),
		disposeScope: (scope) => disposePreviewActivationScopeForState(state, scope),
		dispose: () => resetPreviewActivationSchedulerState(state),
	};
}

const ACTIVATION_REQUEST = Symbol("preview-activation-request");

interface PreviewActivationHandleInternal extends PreviewActivationHandle {
	[ACTIVATION_REQUEST]: PreviewActivationRequest | undefined;
}

interface PreviewActivationSchedulerState extends PreviewSchedulerPartitionRegistry<PreviewActivationPartition> {
	/** Every scope of this scheduler. */
	readonly scopes: Set<PreviewActivationScopeState>;
	readonly getOutstandingPreviewJobCount: () => number;
	readonly subscribeBackpressure:
		| ((listener: PreviewBackpressureChangeListener) => () => void)
		| undefined;
	readonly getActivationsPerSecond: () => number;
	readonly getWindow: (() => Window | null) | undefined;
	readonly roundRobinCursorByPartition: Map<PreviewActivationPartition, number>;
	readonly scrollingPolicy: PreviewActivationPolicy;
	tokenState: PreviewScheduleTokenState;
	blockedForBackpressure: boolean;
	unsubscribeBackpressure: (() => void) | undefined;
	readonly scopeStates: WeakMap<PreviewActivationScope, PreviewActivationScopeState>;
	unsubscribeScrollActivity?: () => void;
	disposed: boolean;
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
		roundRobinCursorByPartition: new Map(),
		scrollingPolicy: { ...SCROLLING_POLICY },
		tokenState: createEmptyPreviewScheduleTokenState(),
		blockedForBackpressure: false,
		unsubscribeBackpressure: undefined,
		...createPreviewSchedulerPartitionRegistry<PreviewActivationPartition>(),
		scopeStates: new WeakMap(),
		disposed: false,
	};
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

function getEmptyOutstandingPreviewJobCount(): number {
	return 0;
}

function getDefaultActivationsPerSecond(): number {
	return DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND;
}

function getOrCreatePartition(
	state: PreviewActivationSchedulerState,
	coordinator: VirtualFrameCoordinator | undefined,
): PreviewActivationPartition {
	return getOrCreatePreviewSchedulerPartition(state, {
		coordinator,
		taskKeyPrefix: "preview:activation-drain",
		getWindow: state.getWindow,
		createPartition: (driver, partitionCoordinator) => ({
			coordinator: partitionCoordinator,
			driver,
			scopes: new Set(),
			pendingScopesScratch: [],
			lastObservedMeasurementEpoch: readVirtualScrollMeasurementEpoch(),
		}),
		onFrame: (partition, timestamp) => drainPartition(state, partition, timestamp),
	});
}

function createPreviewActivationScopeForState(
	schedulerState: PreviewActivationSchedulerState,
	options: CreatePreviewActivationScopeOptions = {},
): PreviewActivationScope {
	if (schedulerState.disposed) {
		return { kind: "preview-activation-scope" };
	}
	const partition = getOrCreatePartition(schedulerState, options.frameCoordinator);
	const scope: PreviewActivationScope = { kind: "preview-activation-scope" };
	const state: PreviewActivationScopeState = {
		scope,
		partition,
		queue: createPreviewKeyedQueue(),
		disposed: false,
	};
	schedulerState.scopeStates.set(scope, state);
	schedulerState.scopes.add(state);
	partition.scopes.add(state);
	return scope;
}

function readScopeState(
	schedulerState: PreviewActivationSchedulerState,
	scope: PreviewActivationScope,
): PreviewActivationScopeState {
	const scopeState = schedulerState.scopeStates.get(scope);
	if (scopeState) return scopeState;
	throw new TypeError("Unknown preview activation scope");
}

function hasPendingScope(scopeState: PreviewActivationScopeState): boolean {
	return !scopeState.disposed && scopeState.queue.size > 0;
}

function hasAnyPendingScope(schedulerState: PreviewActivationSchedulerState): boolean {
	for (const scopeState of schedulerState.scopes) {
		if (hasPendingScope(scopeState)) return true;
	}
	return false;
}

function hasPendingPartition(partition: PreviewActivationPartition): boolean {
	for (const scopeState of partition.scopes) {
		if (hasPendingScope(scopeState)) return true;
	}
	return false;
}

function settleRequest(
	schedulerState: PreviewActivationSchedulerState,
	request: PreviewActivationRequest,
	activated: boolean,
): void {
	if (request.settled) return;

	request.settled = true;
	const scopeState = request.scopeState;
	scopeState.queue.delete(request.key, request);
	if (scopeState.queue.size === 0) scopeState.queue.clear();
	if (activated) invokeActivated(request.onActivated);

	if (!hasAnyPendingScope(schedulerState)) {
		releaseBackpressureSubscription(schedulerState);
	}
	if (!hasPendingPartition(scopeState.partition)) {
		scopeState.partition.driver.cancel();
	}
	releaseScrollActivitySubscriptionIfIdle(schedulerState);
}

function ensureScrollActivitySubscription(
	schedulerState: PreviewActivationSchedulerState,
): void {
	ensurePreviewScrollActivitySubscription(schedulerState, (isActive) => {
		for (const partition of schedulerState.partitionsByIdentity.values()) {
			partition.driver.cancel();
			schedulePartition(schedulerState, partition, 0, isActive);
		}
	});
}

function releaseScrollActivitySubscriptionIfIdle(
	schedulerState: PreviewActivationSchedulerState,
): void {
	releasePreviewScrollActivitySubscriptionIfIdle(
		schedulerState,
		hasAnyPendingScope(schedulerState),
	);
}

function blockForBackpressure(schedulerState: PreviewActivationSchedulerState): void {
	schedulerState.blockedForBackpressure = true;
	ensureBackpressureSubscription(schedulerState);
}

function ensureBackpressureSubscription(
	schedulerState: PreviewActivationSchedulerState,
): void {
	if (
		schedulerState.unsubscribeBackpressure ||
		!schedulerState.subscribeBackpressure
	) {
		return;
	}

	schedulerState.unsubscribeBackpressure = schedulerState.subscribeBackpressure(
		() => {
			const outstandingPreviewJobCount =
				schedulerState.getOutstandingPreviewJobCount();
			if (!hasPreviewAdmissionCapacity(outstandingPreviewJobCount)) {
				schedulerState.blockedForBackpressure = true;
				return;
			}

			schedulerState.blockedForBackpressure = false;
			for (const partition of schedulerState.partitionsByIdentity.values()) {
				schedulePartition(schedulerState, partition);
			}
		},
	);
}

function releaseBackpressureSubscription(
	schedulerState: PreviewActivationSchedulerState,
): void {
	schedulerState.unsubscribeBackpressure?.();
	schedulerState.unsubscribeBackpressure = undefined;
	schedulerState.blockedForBackpressure = false;
}

function canSchedule(schedulerState: PreviewActivationSchedulerState): boolean {
	return (
		!schedulerState.blockedForBackpressure || !schedulerState.subscribeBackpressure
	);
}

function schedulePartition(
	schedulerState: PreviewActivationSchedulerState,
	partition: PreviewActivationPartition,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (partition.driver.isScheduled() || !hasPendingPartition(partition)) {
		return;
	}

	for (const scopeState of partition.scopes) {
		if (!hasPendingScope(scopeState)) continue;
		if (canSchedule(schedulerState)) {
			partition.driver.schedule({
				lane: scrolling ? "post-paint" : "idle",
				delayMs,
			});
			return;
		}
	}
}

function resolveActivationPolicy(
	outstandingPreviewJobCount: number,
	scrolling: boolean,
): PreviewActivationPolicy {
	if (scrolling) return SCROLLING_POLICY;
	if (outstandingPreviewJobCount > 0) {
		return BACKPRESSURED_POLICY;
	}
	return IDLE_POLICY;
}

function hasPreviewAdmissionCapacity(outstandingPreviewJobCount: number): boolean {
	return outstandingPreviewJobCount < MAX_OUTSTANDING_PREVIEW_JOBS;
}

function compactScopeQueue(scopeState: PreviewActivationScopeState): void {
	scopeState.queue.compact();
}

function readNextQueuedRequest(
	scopeState: PreviewActivationScopeState,
): PreviewActivationRequest | undefined {
	return scopeState.queue.dequeue();
}

function readNextRoundRobinRequest(
	schedulerState: PreviewActivationSchedulerState,
	partition: PreviewActivationPartition,
	scopes: readonly PreviewActivationScopeState[],
): PreviewActivationRequest | undefined {
	if (scopes.length === 0) return undefined;
	const cursor = schedulerState.roundRobinCursorByPartition.get(partition) ?? 0;

	for (let offset = 0; offset < scopes.length; offset += 1) {
		const scopeIndex = (cursor + offset) % scopes.length;
		const request = readNextQueuedRequest(scopes[scopeIndex]);
		if (!request) continue;

		schedulerState.roundRobinCursorByPartition.set(
			partition,
			(scopeIndex + 1) % scopes.length,
		);
		return request;
	}
	return undefined;
}

function drainPartitionScopes(
	schedulerState: PreviewActivationSchedulerState,
	partition: PreviewActivationPartition,
	frameTimestamp: number,
	scrolling: boolean,
	shouldDeferUndeferredRequests: boolean,
): number | null {
	const scopes = partition.pendingScopesScratch;
	for (const scopeState of partition.scopes) {
		if (hasPendingScope(scopeState)) scopes.push(scopeState);
	}
	if (scopes.length === 0) return null;

	let outstandingPreviewJobCount = schedulerState.getOutstandingPreviewJobCount();
	let policy = resolveActivationPolicy(outstandingPreviewJobCount, scrolling);
	if (scrolling) {
		schedulerState.scrollingPolicy.ratePerSecond = resolvePositivePreviewRate(
			schedulerState.getActivationsPerSecond(),
			DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
		);
		policy = schedulerState.scrollingPolicy;
	}
	schedulerState.tokenState = refillPreviewScheduleTokens(
		schedulerState.tokenState,
		frameTimestamp,
		policy,
	);

	if (!hasPreviewAdmissionCapacity(outstandingPreviewJobCount)) {
		blockForBackpressure(schedulerState);
		return schedulerState.subscribeBackpressure ? null : 0;
	}
	schedulerState.blockedForBackpressure = false;

	let queueEntriesAvailableAtDrainStart = 0;
	for (const scopeState of scopes) {
		queueEntriesAvailableAtDrainStart += Math.max(
			0,
			scopeState.queue.queuedEntryCount,
		);
	}
	const maxInspectableQueueEntries = Math.min(
		MAX_QUEUE_ENTRIES_PER_DRAIN,
		queueEntriesAvailableAtDrainStart,
	);
	const deadline = readPreviewSchedulingTime() + policy.maxDrainCpuMs;
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumePreviewScheduleToken(schedulerState.tokenState) &&
		drainedTasks < policy.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readPreviewSchedulingTime() <= deadline
	) {
		if (!hasPreviewAdmissionCapacity(outstandingPreviewJobCount)) {
			blockForBackpressure(schedulerState);
			break;
		}

		const request = readNextRoundRobinRequest(schedulerState, partition, scopes);
		if (!request) break;
		inspectedQueueEntries += 1;
		if (request.settled) continue;
		if (
			request.scopeState.queue.get(request.key) !== request ||
			request.scopeState.disposed
		) {
			continue;
		}
		if (
			shouldDeferUndeferredRequests &&
			!request.hasDeferredForVirtualScrollMeasurement
		) {
			request.hasDeferredForVirtualScrollMeasurement = true;
			request.scopeState.queue.enqueue(request.key, request);
			continue;
		}

		settleRequest(schedulerState, request, true);
		schedulerState.tokenState = consumePreviewScheduleToken(
			schedulerState.tokenState,
		);
		drainedTasks += 1;
		outstandingPreviewJobCount = schedulerState.getOutstandingPreviewJobCount();
	}

	for (const scopeState of scopes) compactScopeQueue(scopeState);
	if (schedulerState.blockedForBackpressure || !hasPendingPartition(partition)) {
		return null;
	}
	return readPreviewTokenAvailabilityDelayMs(
		schedulerState.tokenState,
		policy.ratePerSecond,
	);
}

function drainPartition(
	schedulerState: PreviewActivationSchedulerState,
	partition: PreviewActivationPartition,
	frameTimestamp: number,
): void {
	const scrolling = isScrollActivityActive();
	const measurementEpoch = readVirtualScrollMeasurementEpoch();
	const shouldDeferUndeferredRequests =
		shouldDeferPreviewActivationForVirtualScrollMeasurement(
			partition.lastObservedMeasurementEpoch,
		);
	partition.lastObservedMeasurementEpoch = measurementEpoch;

	let nextDelayMs: number | null;
	try {
		nextDelayMs = drainPartitionScopes(
			schedulerState,
			partition,
			frameTimestamp,
			scrolling,
			shouldDeferUndeferredRequests,
		);
	} finally {
		partition.pendingScopesScratch.length = 0;
	}

	if (nextDelayMs !== null) {
		schedulePartition(schedulerState, partition, nextDelayMs, scrolling);
	}
}

function enqueuePreviewActivationRequest(
	schedulerState: PreviewActivationSchedulerState,
	key: string,
	scope: PreviewActivationScope,
	onActivated: (() => void) | undefined,
): PreviewActivationHandle {
	const scopeState = readScopeState(schedulerState, scope);
	if (scopeState.disposed) return createActivationHandle(key, undefined);

	const request: PreviewActivationRequest = {
		schedulerState,
		key,
		scopeState,
		onActivated,
		hasDeferredForVirtualScrollMeasurement: false,
		settled: false,
	};
	const existing = scopeState.queue.enqueue(key, request);
	if (existing) {
		settleRequest(schedulerState, existing, false);
		compactScopeQueue(scopeState);
	}
	ensureScrollActivitySubscription(schedulerState);
	ensureBackpressureSubscription(schedulerState);
	schedulePartition(schedulerState, scopeState.partition);
	return createActivationHandle(key, request);
}

/**
 * Requests preview activation strictly through the time-budgeted queue.
 */
function requestQueuedPreviewActivationForState(
	schedulerState: PreviewActivationSchedulerState,
	key: string,
	scope: PreviewActivationScope,
	onActivated?: () => void,
): PreviewActivationHandle {
	if (schedulerState.disposed) {
		return createActivationHandle(key, undefined);
	}
	return enqueuePreviewActivationRequest(schedulerState, key, scope, onActivated);
}

function resetScopeQueue(
	schedulerState: PreviewActivationSchedulerState,
	scopeState: PreviewActivationScopeState,
): void {
	for (const request of Array.from(scopeState.queue.values())) {
		settleRequest(schedulerState, request, false);
	}
	scopeState.queue.clear();
}

/** Releases one surface scope and cancels all activation requests it owns. */
function disposePreviewActivationScopeForState(
	schedulerState: PreviewActivationSchedulerState,
	scope: PreviewActivationScope,
): void {
	const scopeState = schedulerState.scopeStates.get(scope);
	if (!scopeState || scopeState.disposed) return;

	resetScopeQueue(schedulerState, scopeState);
	scopeState.disposed = true;
	schedulerState.scopes.delete(scopeState);
	schedulerState.roundRobinCursorByPartition.delete(scopeState.partition);
	scopeState.partition.scopes.delete(scopeState);
	schedulerState.scopeStates.delete(scope);

	if (scopeState.partition.scopes.size === 0) {
		scopeState.partition.driver.dispose();
		schedulerState.partitionsByIdentity.delete(
			scopeState.partition.coordinator ??
				schedulerState.fallbackPartitionIdentity,
		);
	}
	if (schedulerState.scopes.size === 0) {
		releaseBackpressureSubscription(schedulerState);
	}
	releaseScrollActivitySubscriptionIfIdle(schedulerState);
}

function resetPreviewActivationSchedulerState(
	schedulerState: PreviewActivationSchedulerState,
): void {
	if (schedulerState.disposed) return;
	schedulerState.disposed = true;
	const scopes = Array.from(schedulerState.scopes, (scopeState) => scopeState.scope);
	for (const scope of scopes) {
		disposePreviewActivationScopeForState(schedulerState, scope);
	}

	for (const partition of schedulerState.partitionsByIdentity.values()) {
		partition.driver.dispose();
	}
	schedulerState.partitionsByIdentity.clear();
	schedulerState.unsubscribeScrollActivity?.();
	schedulerState.unsubscribeScrollActivity = undefined;
}
