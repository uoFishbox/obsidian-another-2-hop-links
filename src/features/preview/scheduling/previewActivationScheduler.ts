import {
	DEBUG_DISABLE_CARD_DOM_PREVIEW,
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
	pendingByKey: Map<string, PreviewActivationRequest>;
	pendingQueue: PreviewActivationRequest[];
	pendingQueueHead: number;
	disposed: boolean;
}

interface PreviewActivationRequest {
	readonly key: string;
	readonly scopeState: PreviewActivationScopeState;
	readonly onActivated: (() => void) | undefined;
	hasDeferredForVirtualScrollMeasurement: boolean;
	settled: boolean;
}

interface PreviewActivationRuntime {
	readonly identity: object;
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

export interface CreatePreviewActivationScopeOptions {
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureListener,
	) => () => void;
	/** Maximum preview activations admitted per second while scrolling. */
	readonly getActivationsPerSecond?: () => number;
	/** Stable identity of the PreviewService whose admission limit is shared. */
	readonly schedulerIdentity?: object;
	readonly frameCoordinator?: VirtualFrameCoordinator;
}

export interface PreviewActivationHandle {
	readonly key: string;
	/** Cancels this activation request if it is still pending. */
	cancel(): void;
}

const ACTIVATION_REQUEST = Symbol("preview-activation-request");
const DEFAULT_RUNTIME_IDENTITY = {};
const FALLBACK_PARTITION_IDENTITY = {};

interface PreviewActivationHandleInternal extends PreviewActivationHandle {
	[ACTIVATION_REQUEST]: PreviewActivationRequest | undefined;
}

const scopeStates = new WeakMap<PreviewActivationScope, PreviewActivationScopeState>();
const runtimesByIdentity = new Map<object, PreviewActivationRuntime>();
const partitionsByIdentity = new Map<object, PreviewActivationPartition>();
let nextPartitionId = 0;
let unsubscribeScrollActivity: (() => void) | undefined;

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
	if (request) settleRequest(request, false);
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

function resolveRuntimeIdentity(options: CreatePreviewActivationScopeOptions): object {
	if (options.schedulerIdentity) return options.schedulerIdentity;
	if (options.getBackpressure) return options.getBackpressure;
	if (options.subscribeBackpressure) return options.subscribeBackpressure;
	if (options.getActivationsPerSecond) return options.getActivationsPerSecond;
	return DEFAULT_RUNTIME_IDENTITY;
}

function getOrCreateRuntime(
	options: CreatePreviewActivationScopeOptions,
): PreviewActivationRuntime {
	const identity = resolveRuntimeIdentity(options);
	const existing = runtimesByIdentity.get(identity);
	if (existing) return existing;

	const runtime: PreviewActivationRuntime = {
		identity,
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
	runtimesByIdentity.set(identity, runtime);
	return runtime;
}

function getOrCreatePartition(
	coordinator: VirtualFrameCoordinator | undefined,
): PreviewActivationPartition {
	const identity = coordinator ?? FALLBACK_PARTITION_IDENTITY;
	const existing = partitionsByIdentity.get(identity);
	if (existing) return existing;

	let partition: PreviewActivationPartition;
	const taskKey = `preview:activation-drain:${++nextPartitionId}`;
	const driver = createPreviewFrameDriver({
		coordinator,
		taskKey,
		onAnimationFrameScheduled: () => {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.activationScheduler.animationFrame");
			}
		},
		onFrame: (timestamp) => drainPartition(partition, timestamp),
	});
	partition = {
		coordinator,
		driver,
		scopes: new Set(),
		pendingRuntimesScratch: new Set(),
		pendingScopesScratch: [],
		lastObservedMeasurementEpoch: readVirtualScrollMeasurementEpoch(),
	};
	partitionsByIdentity.set(identity, partition);
	return partition;
}

export function createPreviewActivationScope(
	options: CreatePreviewActivationScopeOptions = {},
): PreviewActivationScope {
	const runtime = getOrCreateRuntime(options);
	const partition = getOrCreatePartition(options.frameCoordinator);
	const scope: PreviewActivationScope = { kind: "preview-activation-scope" };
	const state: PreviewActivationScopeState = {
		scope,
		runtime,
		partition,
		pendingByKey: new Map(),
		pendingQueue: [],
		pendingQueueHead: 0,
		disposed: false,
	};
	scopeStates.set(scope, state);
	runtime.scopes.add(state);
	partition.scopes.add(state);
	return scope;
}

function readScopeState(scope: PreviewActivationScope): PreviewActivationScopeState {
	const state = scopeStates.get(scope);
	if (state) return state;
	throw new TypeError("Unknown preview activation scope");
}

function hasPendingScope(scopeState: PreviewActivationScopeState): boolean {
	return !scopeState.disposed && scopeState.pendingByKey.size > 0;
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

function settleRequest(request: PreviewActivationRequest, activated: boolean): void {
	if (request.settled) return;

	request.settled = true;
	const scopeState = request.scopeState;
	if (scopeState.pendingByKey.get(request.key) === request) {
		scopeState.pendingByKey.delete(request.key);
	}
	if (scopeState.pendingByKey.size === 0) {
		scopeState.pendingQueue = [];
		scopeState.pendingQueueHead = 0;
	}
	if (activated) invokeActivated(request.onActivated);

	if (!hasPendingRuntime(scopeState.runtime)) {
		releaseRuntimeBackpressureSubscription(scopeState.runtime);
	}
	if (!hasPendingPartition(scopeState.partition)) {
		scopeState.partition.driver.cancel();
	}
	releaseScrollActivitySubscriptionIfIdle();
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

function hasAnyPendingActivation(): boolean {
	for (const partition of partitionsByIdentity.values()) {
		if (hasPendingPartition(partition)) return true;
	}
	return false;
}

function releaseScrollActivitySubscriptionIfIdle(): void {
	if (hasAnyPendingActivation()) return;
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

function ensureRuntimeBackpressureSubscription(
	runtime: PreviewActivationRuntime,
): void {
	if (runtime.unsubscribeBackpressure || !runtime.subscribeBackpressure) return;

	runtime.unsubscribeBackpressure = runtime.subscribeBackpressure(() => {
		runtime.blockedForBackpressure = false;
		for (const scopeState of runtime.scopes) {
			if (hasPendingScope(scopeState)) schedulePartition(scopeState.partition);
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
	if (
		scopeState.pendingQueueHead < 64 &&
		scopeState.pendingQueue.length <= scopeState.pendingByKey.size * 2 + 16
	) {
		return;
	}

	scopeState.pendingQueue = scopeState.pendingQueue
		.slice(scopeState.pendingQueueHead)
		.filter(
			(request) =>
				!request.settled &&
				scopeState.pendingByKey.get(request.key) === request,
		);
	scopeState.pendingQueueHead = 0;
}

function readNextQueuedRequest(
	scopeState: PreviewActivationScopeState,
): PreviewActivationRequest | undefined {
	if (scopeState.pendingQueueHead >= scopeState.pendingQueue.length) {
		return undefined;
	}

	const request = scopeState.pendingQueue[scopeState.pendingQueueHead];
	scopeState.pendingQueueHead += 1;
	return request;
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
		ensureRuntimeBackpressureSubscription(runtime);
		return runtime.subscribeBackpressure ? null : 0;
	}
	runtime.blockedForBackpressure = false;

	let queueEntriesAvailableAtDrainStart = 0;
	for (const scopeState of scopes) {
		queueEntriesAvailableAtDrainStart += Math.max(
			0,
			scopeState.pendingQueue.length - scopeState.pendingQueueHead,
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
			ensureRuntimeBackpressureSubscription(runtime);
			break;
		}

		const request = readNextRoundRobinRequest(runtime, partition, scopes);
		if (!request) break;
		inspectedQueueEntries += 1;
		if (request.settled) continue;
		if (
			request.scopeState.pendingByKey.get(request.key) !== request ||
			request.scopeState.disposed
		) {
			continue;
		}
		if (
			shouldDeferUndeferredRequests &&
			!request.hasDeferredForVirtualScrollMeasurement
		) {
			request.hasDeferredForVirtualScrollMeasurement = true;
			request.scopeState.pendingQueue.push(request);
			continue;
		}

		if (scrolling && process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("preview.activationDuringScroll");
		}

		settleRequest(request, true);
		runtime.tokenState = consumePreviewScheduleToken(runtime.tokenState);
		drainedTasks += 1;
	}

	for (const scopeState of scopes) compactScopeQueue(scopeState);
	if (!hasPendingRuntime(runtime) || runtime.blockedForBackpressure) return null;
	return 0;
}

function drainPartition(
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
		schedulePartition(partition, nextDelayMs, scrolling);
	}
}

function enqueuePreviewActivationRequest(
	key: string,
	scope: PreviewActivationScope,
	onActivated: (() => void) | undefined,
): PreviewActivationHandle {
	const scopeState = readScopeState(scope);
	if (scopeState.disposed) return createActivationHandle(key, undefined);

	const existing = scopeState.pendingByKey.get(key);
	if (existing) settleRequest(existing, false);

	const request: PreviewActivationRequest = {
		key,
		scopeState,
		onActivated,
		hasDeferredForVirtualScrollMeasurement: false,
		settled: false,
	};
	scopeState.pendingByKey.set(key, request);
	scopeState.pendingQueue.push(request);
	scopeState.runtime.blockedForBackpressure = false;
	ensureScrollActivitySubscription();
	ensureRuntimeBackpressureSubscription(scopeState.runtime);
	schedulePartition(scopeState.partition);
	return createActivationHandle(key, request);
}

/**
 * Requests preview activation strictly through the time-budgeted queue.
 */
export function requestQueuedPreviewActivation(
	key: string,
	scope: PreviewActivationScope,
	onActivated?: () => void,
): PreviewActivationHandle {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
		return createActivationHandle(key, undefined);
	}
	return enqueuePreviewActivationRequest(key, scope, onActivated);
}

function resetScopeQueue(scopeState: PreviewActivationScopeState): void {
	for (const request of Array.from(scopeState.pendingByKey.values())) {
		settleRequest(request, false);
	}
	scopeState.pendingByKey.clear();
	scopeState.pendingQueue = [];
	scopeState.pendingQueueHead = 0;
}

/** Releases one surface scope and cancels all activation requests it owns. */
export function disposePreviewActivationScope(scope: PreviewActivationScope): void {
	const scopeState = scopeStates.get(scope);
	if (!scopeState || scopeState.disposed) return;

	resetScopeQueue(scopeState);
	scopeState.disposed = true;
	scopeState.runtime.scopes.delete(scopeState);
	scopeState.runtime.roundRobinCursorByPartition.delete(scopeState.partition);
	scopeState.partition.scopes.delete(scopeState);
	scopeStates.delete(scope);

	if (scopeState.partition.scopes.size === 0) {
		scopeState.partition.driver.dispose();
		partitionsByIdentity.delete(
			scopeState.partition.coordinator ?? FALLBACK_PARTITION_IDENTITY,
		);
	}
	if (scopeState.runtime.scopes.size === 0) {
		releaseRuntimeBackpressureSubscription(scopeState.runtime);
		runtimesByIdentity.delete(scopeState.runtime.identity);
	}
	releaseScrollActivitySubscriptionIfIdle();
}

function resetPreviewActivationSchedulerState(): void {
	const scopes = Array.from(runtimesByIdentity.values()).flatMap((runtime) =>
		Array.from(runtime.scopes, (scopeState) => scopeState.scope),
	);
	for (const scope of scopes) disposePreviewActivationScope(scope);

	for (const partition of partitionsByIdentity.values()) {
		partition.driver.dispose();
	}
	partitionsByIdentity.clear();
	runtimesByIdentity.clear();
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

/** Stops activation scheduling and settles all pending activation requests. */
export function disposePreviewActivationScheduler(): void {
	resetPreviewActivationSchedulerState();
}

export function resetPreviewActivationSchedulerForTests(): void {
	resetPreviewActivationSchedulerState();
}
