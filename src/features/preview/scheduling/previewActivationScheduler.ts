import {
	getDebugDisableCardDomPreview,
	DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
} from "../../../appConstants";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "ui/virtualization/scheduling/scrollActivity";
import {
	readVirtualScrollMeasurementEpoch,
	shouldDeferPreviewActivationForVirtualScrollMeasurement,
} from "ui/virtualization/scheduling/virtualScrollMeasurementFrame";
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

export interface PreviewBackpressure {
	readonly queued: number;
	readonly active: number;
}

export type PreviewBackpressureListener = (pressure: PreviewBackpressure) => void;

export interface PreviewActivationScope {
	readonly kind: "preview-activation-scope";
}

interface PreviewActivationScopeState {
	readonly scope: PreviewActivationScope;
	readonly runtime: PreviewActivationRuntime;
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

interface PreviewActivationRuntime {
	readonly scopes: Set<PreviewActivationScopeState>;
	readonly getBackpressure: () => PreviewBackpressure;
	readonly subscribeBackpressure:
		| ((listener: PreviewBackpressureListener) => () => void)
		| undefined;
	readonly getActivationsPerSecond: () => number;
	readonly roundRobinCursorByPartition: Map<PreviewActivationPartition, number>;
	readonly scrollingPolicy: PreviewActivationPolicy;
	tokenState: PreviewScheduleTokenState;
	blockedForBackpressure: boolean;
	unsubscribeBackpressure: (() => void) | undefined;
}

interface PreviewActivationPartition {
	readonly coordinator: VirtualFrameCoordinator | undefined;
	readonly driver: PreviewFrameDriver;
	readonly scopes: Set<PreviewActivationScopeState>;
	readonly pendingRuntimesScratch: Set<PreviewActivationRuntime>;
	readonly pendingScopesScratch: PreviewActivationScopeState[];
	lastObservedMeasurementEpoch: number;
}

/**
 * Runtime-wide activation policy shared by every scope of one scheduler.
 *
 * The plugin runtime configures these once per PreviewService; surfaces must
 * not override them per scope.
 */
export interface CreatePreviewActivationSchedulerOptions {
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureListener,
	) => () => void;
	/** Maximum preview activations admitted per second while scrolling. */
	readonly getActivationsPerSecond?: () => number;
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

interface PreviewActivationSchedulerState {
	readonly runtime: PreviewActivationRuntime;
	readonly fallbackPartitionIdentity: object;
	readonly scopeStates: WeakMap<PreviewActivationScope, PreviewActivationScopeState>;
	readonly partitionsByIdentity: Map<object, PreviewActivationPartition>;
	nextPartitionId: number;
	unsubscribeScrollActivity?: () => void;
}

function createSchedulerState(
	options: CreatePreviewActivationSchedulerOptions,
): PreviewActivationSchedulerState {
	const runtime: PreviewActivationRuntime = {
		scopes: new Set(),
		getBackpressure: options.getBackpressure ?? getEmptyBackpressure,
		subscribeBackpressure: options.subscribeBackpressure,
		getActivationsPerSecond:
			options.getActivationsPerSecond ?? getDefaultActivationsPerSecond,
		roundRobinCursorByPartition: new Map(),
		scrollingPolicy: { ...SCROLLING_POLICY },
		tokenState: createEmptyPreviewScheduleTokenState(),
		blockedForBackpressure: false,
		unsubscribeBackpressure: undefined,
	};
	return {
		runtime,
		fallbackPartitionIdentity: {},
		scopeStates: new WeakMap(),
		partitionsByIdentity: new Map(),
		nextPartitionId: 0,
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

function getEmptyBackpressure(): PreviewBackpressure {
	return { queued: 0, active: 0 };
}

function getDefaultActivationsPerSecond(): number {
	return DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND;
}

function resolvePositiveRate(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getOrCreatePartition(
	state: PreviewActivationSchedulerState,
	coordinator: VirtualFrameCoordinator | undefined,
): PreviewActivationPartition {
	const identity = coordinator ?? state.fallbackPartitionIdentity;
	const existing = state.partitionsByIdentity.get(identity);
	if (existing) return existing;

	let partition: PreviewActivationPartition;
	const taskKey = `preview:activation-drain:${++state.nextPartitionId}`;
	const driver = createPreviewFrameDriver({
		coordinator,
		taskKey,
		onAnimationFrameScheduled: () => {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.activationScheduler.animationFrame");
			}
		},
		onFrame: (timestamp) => drainPartition(state, partition, timestamp),
	});
	partition = {
		coordinator,
		driver,
		scopes: new Set(),
		pendingRuntimesScratch: new Set(),
		pendingScopesScratch: [],
		lastObservedMeasurementEpoch: readVirtualScrollMeasurementEpoch(),
	};
	state.partitionsByIdentity.set(identity, partition);
	return partition;
}

function createPreviewActivationScopeForState(
	schedulerState: PreviewActivationSchedulerState,
	options: CreatePreviewActivationScopeOptions = {},
): PreviewActivationScope {
	const runtime = schedulerState.runtime;
	const partition = getOrCreatePartition(schedulerState, options.frameCoordinator);
	const scope: PreviewActivationScope = { kind: "preview-activation-scope" };
	const state: PreviewActivationScopeState = {
		scope,
		runtime,
		partition,
		queue: createPreviewKeyedQueue(),
		disposed: false,
	};
	schedulerState.scopeStates.set(scope, state);
	runtime.scopes.add(state);
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

function hasPendingRuntime(runtime: PreviewActivationRuntime): boolean {
	for (const scopeState of runtime.scopes) {
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

	if (!hasPendingRuntime(scopeState.runtime)) {
		releaseRuntimeBackpressureSubscription(scopeState.runtime);
	}
	if (!hasPendingPartition(scopeState.partition)) {
		scopeState.partition.driver.cancel();
	}
	releaseScrollActivitySubscriptionIfIdle(schedulerState);
}

function ensureScrollActivitySubscription(
	schedulerState: PreviewActivationSchedulerState,
): void {
	if (schedulerState.unsubscribeScrollActivity) return;

	schedulerState.unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		for (const partition of schedulerState.partitionsByIdentity.values()) {
			partition.driver.cancel();
			schedulePartition(schedulerState, partition, 0, isActive);
		}
	});
}

function hasAnyPendingActivation(
	schedulerState: PreviewActivationSchedulerState,
): boolean {
	for (const partition of schedulerState.partitionsByIdentity.values()) {
		if (hasPendingPartition(partition)) return true;
	}
	return false;
}

function releaseScrollActivitySubscriptionIfIdle(
	schedulerState: PreviewActivationSchedulerState,
): void {
	if (hasAnyPendingActivation(schedulerState)) return;
	schedulerState.unsubscribeScrollActivity?.();
	schedulerState.unsubscribeScrollActivity = undefined;
}

function ensureRuntimeBackpressureSubscription(
	schedulerState: PreviewActivationSchedulerState,
	runtime: PreviewActivationRuntime,
): void {
	if (runtime.unsubscribeBackpressure || !runtime.subscribeBackpressure) return;

	runtime.unsubscribeBackpressure = runtime.subscribeBackpressure(() => {
		runtime.blockedForBackpressure = false;
		for (const scopeState of runtime.scopes) {
			if (hasPendingScope(scopeState)) {
				schedulePartition(schedulerState, scopeState.partition);
			}
		}
	});
}

function releaseRuntimeBackpressureSubscription(
	runtime: PreviewActivationRuntime,
): void {
	runtime.unsubscribeBackpressure?.();
	runtime.unsubscribeBackpressure = undefined;
	runtime.blockedForBackpressure = false;
}

function canScheduleRuntime(runtime: PreviewActivationRuntime): boolean {
	return !runtime.blockedForBackpressure || !runtime.subscribeBackpressure;
}

function schedulePartition(
	_schedulerState: PreviewActivationSchedulerState,
	partition: PreviewActivationPartition,
	delayMs = 0,
	scrolling = isScrollActivityActive(),
): void {
	if (partition.driver.isScheduled() || !hasPendingPartition(partition)) {
		return;
	}

	for (const scopeState of partition.scopes) {
		if (!hasPendingScope(scopeState)) continue;
		if (canScheduleRuntime(scopeState.runtime)) {
			partition.driver.schedule({
				lane: scrolling ? "post-paint" : "idle",
				delayMs,
			});
			return;
		}
	}
}

function resolveActivationPolicy(
	pressure: PreviewBackpressure,
	scrolling: boolean,
): PreviewActivationPolicy {
	if (scrolling) return SCROLLING_POLICY;
	if (pressure.queued > 0 || pressure.active > 0) {
		return BACKPRESSURED_POLICY;
	}
	return IDLE_POLICY;
}

function hasPreviewAdmissionCapacity(pressure: PreviewBackpressure): boolean {
	return pressure.queued + pressure.active < MAX_OUTSTANDING_PREVIEW_JOBS;
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
	runtime: PreviewActivationRuntime,
	partition: PreviewActivationPartition,
	scopes: readonly PreviewActivationScopeState[],
): PreviewActivationRequest | undefined {
	if (scopes.length === 0) return undefined;
	const cursor = runtime.roundRobinCursorByPartition.get(partition) ?? 0;

	for (let offset = 0; offset < scopes.length; offset += 1) {
		const scopeIndex = (cursor + offset) % scopes.length;
		const request = readNextQueuedRequest(scopes[scopeIndex]);
		if (!request) continue;

		runtime.roundRobinCursorByPartition.set(
			partition,
			(scopeIndex + 1) % scopes.length,
		);
		return request;
	}
	return undefined;
}

function drainRuntimePartition(
	schedulerState: PreviewActivationSchedulerState,
	runtime: PreviewActivationRuntime,
	partition: PreviewActivationPartition,
	frameTimestamp: number,
	scrolling: boolean,
	shouldDeferUndeferredRequests: boolean,
): number | null {
	const scopes = partition.pendingScopesScratch;
	for (const scopeState of partition.scopes) {
		if (scopeState.runtime === runtime && hasPendingScope(scopeState)) {
			scopes.push(scopeState);
		}
	}
	if (scopes.length === 0) return null;

	const pressure = runtime.getBackpressure();
	let policy = resolveActivationPolicy(pressure, scrolling);
	if (scrolling) {
		runtime.scrollingPolicy.ratePerSecond = resolvePositiveRate(
			runtime.getActivationsPerSecond(),
			DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
		);
		policy = runtime.scrollingPolicy;
	}
	runtime.tokenState = refillPreviewScheduleTokens(
		runtime.tokenState,
		frameTimestamp,
		policy,
	);

	if (!hasPreviewAdmissionCapacity(pressure)) {
		runtime.blockedForBackpressure = true;
		ensureRuntimeBackpressureSubscription(schedulerState, runtime);
		return runtime.subscribeBackpressure ? null : 0;
	}
	runtime.blockedForBackpressure = false;

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
		canConsumePreviewScheduleToken(runtime.tokenState) &&
		drainedTasks < policy.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readPreviewSchedulingTime() <= deadline
	) {
		if (!hasPreviewAdmissionCapacity(runtime.getBackpressure())) {
			runtime.blockedForBackpressure = true;
			ensureRuntimeBackpressureSubscription(schedulerState, runtime);
			break;
		}

		const request = readNextRoundRobinRequest(runtime, partition, scopes);
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

		if (scrolling && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("preview.activationDuringScroll");
		}

		settleRequest(schedulerState, request, true);
		runtime.tokenState = consumePreviewScheduleToken(runtime.tokenState);
		drainedTasks += 1;
	}

	for (const scopeState of scopes) compactScopeQueue(scopeState);
	if (!hasPendingRuntime(runtime) || runtime.blockedForBackpressure) return null;
	return 0;
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
	const runtimes = partition.pendingRuntimesScratch;
	for (const scopeState of partition.scopes) {
		if (hasPendingScope(scopeState)) runtimes.add(scopeState.runtime);
	}

	let nextDelayMs = Number.POSITIVE_INFINITY;
	try {
		for (const runtime of runtimes) {
			let delayMs: number | null;
			try {
				delayMs = drainRuntimePartition(
					schedulerState,
					runtime,
					partition,
					frameTimestamp,
					scrolling,
					shouldDeferUndeferredRequests,
				);
			} finally {
				partition.pendingScopesScratch.length = 0;
			}
			if (delayMs !== null) nextDelayMs = Math.min(nextDelayMs, delayMs);
		}
	} finally {
		runtimes.clear();
	}

	if (Number.isFinite(nextDelayMs)) {
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

	const existing = scopeState.queue.get(key);
	if (existing) settleRequest(schedulerState, existing, false);

	const request: PreviewActivationRequest = {
		schedulerState,
		key,
		scopeState,
		onActivated,
		hasDeferredForVirtualScrollMeasurement: false,
		settled: false,
	};
	scopeState.queue.enqueue(key, request);
	scopeState.runtime.blockedForBackpressure = false;
	ensureScrollActivitySubscription(schedulerState);
	ensureRuntimeBackpressureSubscription(schedulerState, scopeState.runtime);
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
	if (getDebugDisableCardDomPreview()) {
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
	scopeState.runtime.scopes.delete(scopeState);
	scopeState.runtime.roundRobinCursorByPartition.delete(scopeState.partition);
	scopeState.partition.scopes.delete(scopeState);
	schedulerState.scopeStates.delete(scope);

	if (scopeState.partition.scopes.size === 0) {
		scopeState.partition.driver.dispose();
		schedulerState.partitionsByIdentity.delete(
			scopeState.partition.coordinator ??
				schedulerState.fallbackPartitionIdentity,
		);
	}
	if (scopeState.runtime.scopes.size === 0) {
		releaseRuntimeBackpressureSubscription(scopeState.runtime);
	}
	releaseScrollActivitySubscriptionIfIdle(schedulerState);
}

function resetPreviewActivationSchedulerState(
	schedulerState: PreviewActivationSchedulerState,
): void {
	const scopes = Array.from(
		schedulerState.runtime.scopes,
		(scopeState) => scopeState.scope,
	);
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
