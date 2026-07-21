import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "ui/virtualization/scheduling/scrollActivity";
import { shouldDeferPreviewActivationForVirtualScrollMeasurement } from "ui/virtualization/scheduling/virtualScrollMeasurementFrame";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";
import {
	canConsumePreviewScheduleToken,
	consumePreviewScheduleToken,
	createEmptyPreviewScheduleTokenState,
	refillPreviewScheduleTokens,
	type PreviewScheduleTokenState,
} from "./previewScheduleTokenBucket";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;
const FALLBACK_FRAME_INTERVAL_MS = 1000 / 60;
const MAX_OUTSTANDING_PREVIEW_JOBS = 3;

interface PreviewActivationPolicy {
	readonly ratePerSecond: number;
	readonly creditCapacity: number;
	readonly maxTasksPerDrain: number;
	readonly maxDrainCpuMs: number;
}

const IDLE_POLICY: PreviewActivationPolicy = {
	ratePerSecond: 120,
	creditCapacity: 2,
	maxTasksPerDrain: 2,
	maxDrainCpuMs: 2,
};
const BACKPRESSURED_POLICY: PreviewActivationPolicy = {
	ratePerSecond: 30,
	creditCapacity: 2,
	maxTasksPerDrain: 1,
	maxDrainCpuMs: 1,
};

export interface PreviewBackpressure {
	readonly queued: number;
	readonly active: number;
}

export interface PreviewActivationScope {
	pendingByKey: Map<string, PreviewActivationRequest>;
	pendingQueue: PreviewActivationRequest[];
	pendingQueueHead: number;
	getBackpressure: () => PreviewBackpressure;
	frameCoordinator?: VirtualFrameCoordinator;
}

interface PreviewActivationRequest {
	key: string;
	scope: PreviewActivationScope;
	onActivated: (() => void) | undefined;
	hasDeferredForVirtualScrollMeasurement: boolean;
	settled: boolean;
}

export interface CreatePreviewActivationScopeOptions {
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly frameCoordinator?: VirtualFrameCoordinator;
}

export interface PreviewActivationHandle {
	key: string;
	/** Cancels this activation request if it is still pending. */
	cancel(): void;
}

const ACTIVATION_REQUEST = Symbol("preview-activation-request");

interface PreviewActivationHandleInternal extends PreviewActivationHandle {
	[ACTIVATION_REQUEST]: PreviewActivationRequest | undefined;
}

const activeQueuedScopes = new Set<PreviewActivationScope>();
let globalFrameHandle: number | null = null;
let globalFrameHandleKind: "animation-frame" | "timeout" | null = null;
let globalFrameCoordinator: VirtualFrameCoordinator | undefined;
let roundRobinCursor = 0;
let activationTokenState: PreviewScheduleTokenState =
	createEmptyPreviewScheduleTokenState();
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
	if (request) {
		settleRequest(request, false);
	}
}

function invokeActivated(onActivated: (() => void) | undefined): void {
	try {
		onActivated?.();
	} catch (error) {
		console.error("Preview activation callback failed", error);
	}
}

function readMonotonicTime(): number {
	if (typeof globalThis.performance?.now === "function") {
		return globalThis.performance.now();
	}
	return Date.now();
}

function getEmptyBackpressure(): PreviewBackpressure {
	return { queued: 0, active: 0 };
}

export function createPreviewActivationScope(
	options: CreatePreviewActivationScopeOptions = {},
): PreviewActivationScope {
	return {
		pendingByKey: new Map<string, PreviewActivationRequest>(),
		pendingQueue: [],
		pendingQueueHead: 0,
		getBackpressure: options.getBackpressure ?? getEmptyBackpressure,
		frameCoordinator: options.frameCoordinator,
	};
}

function settleRequest(request: PreviewActivationRequest, activated: boolean): void {
	if (request.settled) return;

	request.settled = true;
	if (request.scope.pendingByKey.get(request.key) === request) {
		request.scope.pendingByKey.delete(request.key);
	}
	if (request.scope.pendingByKey.size === 0) {
		activeQueuedScopes.delete(request.scope);
		request.scope.pendingQueue = [];
		request.scope.pendingQueueHead = 0;
	}
	if (activated) {
		invokeActivated(request.onActivated);
	}
	releaseGlobalResourcesIfIdle();
}

function ensureSubscription(): void {
	if (unsubscribeScrollActivity) return;

	unsubscribeScrollActivity = subscribeScrollActivity((isActive) => {
		if (isActive) {
			cancelGlobalFrame();
			return;
		}
		scheduleGlobalFrameDrain();
	});
}

function scheduleGlobalFrameDrain(): void {
	if (
		globalFrameHandle !== null ||
		globalFrameCoordinator !== undefined ||
		activeQueuedScopes.size === 0 ||
		isScrollActivityActive()
	) {
		return;
	}
	const queuedCoordinator = resolveQueuedCoordinator();
	if (queuedCoordinator) {
		const scheduled = queuedCoordinator.schedule(
			"idle",
			"preview:activation-drain",
			() => {
				globalFrameCoordinator = undefined;
				drainGlobalFrame(readMonotonicTime());
			},
		);
		if (scheduled) {
			globalFrameCoordinator = queuedCoordinator;
			return;
		}
	}

	if (typeof globalThis.requestAnimationFrame === "function") {
		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("preview.activationScheduler.animationFrame");
		}
		globalFrameHandleKind = "animation-frame";
		globalFrameHandle = globalThis.requestAnimationFrame((timestamp) => {
			globalFrameHandle = null;
			globalFrameHandleKind = null;
			drainGlobalFrame(timestamp);
		});
		return;
	}

	if (typeof globalThis.setTimeout !== "function") return;

	globalFrameHandleKind = "timeout";
	globalFrameHandle = globalThis.setTimeout(() => {
		globalFrameHandle = null;
		globalFrameHandleKind = null;
		drainGlobalFrame(readMonotonicTime());
	}, FALLBACK_FRAME_INTERVAL_MS) as unknown as number;
}

function resolveQueuedCoordinator(): VirtualFrameCoordinator | undefined {
	let coordinator: VirtualFrameCoordinator | undefined;
	for (const scope of activeQueuedScopes) {
		if (!scope.frameCoordinator) return undefined;
		if (coordinator && coordinator !== scope.frameCoordinator) return undefined;
		coordinator = scope.frameCoordinator;
	}
	return coordinator;
}

function cancelGlobalFrame(): void {
	if (globalFrameCoordinator) {
		globalFrameCoordinator.cancel("idle", "preview:activation-drain");
		globalFrameCoordinator = undefined;
	}
	if (globalFrameHandle === null) return;

	if (
		globalFrameHandleKind === "animation-frame" &&
		typeof globalThis.cancelAnimationFrame === "function"
	) {
		globalThis.cancelAnimationFrame(globalFrameHandle);
	} else if (typeof globalThis.clearTimeout === "function") {
		globalThis.clearTimeout(globalFrameHandle);
	}

	globalFrameHandle = null;
	globalFrameHandleKind = null;
}

function releaseGlobalResourcesIfIdle(): void {
	if (activeQueuedScopes.size > 0) return;

	cancelGlobalFrame();
	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

function readScopeBackpressure(scope: PreviewActivationScope): PreviewBackpressure {
	return scope.getBackpressure();
}

function readGlobalBackpressure(): PreviewBackpressure {
	let queued = 0;
	let active = 0;

	for (const scope of activeQueuedScopes) {
		const pressure = readScopeBackpressure(scope);
		queued = Math.max(queued, pressure.queued);
		active = Math.max(active, pressure.active);
	}

	return { queued, active };
}

function resolveActivationPolicy(params: {
	readonly queuedPreviewJobs: number;
	readonly activePreviewJobs: number;
}): PreviewActivationPolicy {
	if (params.queuedPreviewJobs > 0 || params.activePreviewJobs > 0) {
		return BACKPRESSURED_POLICY;
	}

	return IDLE_POLICY;
}

function refillActivationTokens(
	timestamp: number,
	policy: PreviewActivationPolicy,
): void {
	activationTokenState = refillPreviewScheduleTokens(
		activationTokenState,
		timestamp,
		policy,
	);
}

function hasPreviewAdmissionCapacity(pressure: PreviewBackpressure): boolean {
	return pressure.queued + pressure.active < MAX_OUTSTANDING_PREVIEW_JOBS;
}

function compactScopeQueue(scope: PreviewActivationScope): void {
	if (
		scope.pendingQueueHead < 64 &&
		scope.pendingQueue.length <= scope.pendingByKey.size * 2 + 16
	) {
		return;
	}

	scope.pendingQueue = scope.pendingQueue
		.slice(scope.pendingQueueHead)
		.filter(
			(request) =>
				!request.settled && scope.pendingByKey.get(request.key) === request,
		);
	scope.pendingQueueHead = 0;
}

function readNextQueuedRequest(
	scope: PreviewActivationScope,
): PreviewActivationRequest | undefined {
	if (scope.pendingQueueHead >= scope.pendingQueue.length) return undefined;

	const request = scope.pendingQueue[scope.pendingQueueHead];
	scope.pendingQueueHead += 1;
	return request;
}

function readNextRoundRobinRequest(
	scopes: readonly PreviewActivationScope[],
): PreviewActivationRequest | undefined {
	if (scopes.length === 0) return undefined;

	for (let offset = 0; offset < scopes.length; offset += 1) {
		const scopeIndex = (roundRobinCursor + offset) % scopes.length;
		const scope = scopes[scopeIndex];
		const request = readNextQueuedRequest(scope);
		if (!request) continue;

		roundRobinCursor = (scopeIndex + 1) % scopes.length;
		return request;
	}

	return undefined;
}

function drainGlobalFrame(frameTimestamp: number): void {
	if (activeQueuedScopes.size === 0) return;
	if (isScrollActivityActive()) return;

	const pressure = readGlobalBackpressure();
	const policy = resolveActivationPolicy({
		queuedPreviewJobs: pressure.queued,
		activePreviewJobs: pressure.active,
	});
	refillActivationTokens(frameTimestamp, policy);

	const scopes = Array.from(activeQueuedScopes);
	const shouldDeferUndeferredRequests =
		shouldDeferPreviewActivationForVirtualScrollMeasurement();
	const queueEntriesAvailableAtDrainStart = scopes.reduce(
		(total, scope) =>
			total + Math.max(0, scope.pendingQueue.length - scope.pendingQueueHead),
		0,
	);
	const maxInspectableQueueEntries = Math.min(
		MAX_QUEUE_ENTRIES_PER_DRAIN,
		queueEntriesAvailableAtDrainStart,
	);
	const deadline = readMonotonicTime() + policy.maxDrainCpuMs;
	let inspectedQueueEntries = 0;
	let drainedTasks = 0;

	while (
		canConsumePreviewScheduleToken(activationTokenState) &&
		drainedTasks < policy.maxTasksPerDrain &&
		inspectedQueueEntries < maxInspectableQueueEntries &&
		readMonotonicTime() <= deadline
	) {
		if (!hasPreviewAdmissionCapacity(readGlobalBackpressure())) break;

		const request = readNextRoundRobinRequest(scopes);
		if (!request) break;
		inspectedQueueEntries += 1;
		if (request.settled) continue;
		if (request.scope.pendingByKey.get(request.key) !== request) continue;
		if (
			shouldDeferUndeferredRequests &&
			!request.hasDeferredForVirtualScrollMeasurement
		) {
			request.hasDeferredForVirtualScrollMeasurement = true;
			request.scope.pendingQueue.push(request);
			continue;
		}

		if (isScrollActivityActive()) {
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("preview.activationDuringScroll");
			}
			request.scope.pendingQueue.push(request);
			break;
		}

		settleRequest(request, true);
		activationTokenState = consumePreviewScheduleToken(activationTokenState);
		drainedTasks += 1;
	}

	for (const scope of scopes) {
		compactScopeQueue(scope);
	}

	if (activeQueuedScopes.size > 0) {
		scheduleGlobalFrameDrain();
	}
}

function enqueuePreviewActivationRequest(
	key: string,
	scope: PreviewActivationScope,
	onActivated: (() => void) | undefined,
): PreviewActivationHandle {
	const existing = scope.pendingByKey.get(key);
	if (existing) {
		settleRequest(existing, false);
	}
	ensureSubscription();

	const request: PreviewActivationRequest = {
		key,
		scope,
		onActivated,
		hasDeferredForVirtualScrollMeasurement: false,
		settled: false,
	};
	scope.pendingByKey.set(key, request);
	scope.pendingQueue.push(request);
	activeQueuedScopes.add(scope);
	scheduleGlobalFrameDrain();

	return createActivationHandle(key, request);
}

/**
 * Requests preview activation strictly through the time-budgeted queue.
 *
 * Unlike a synchronously-resolved activation, this never activates before the
 * idle frame drain, so multiple visible cards stay rate-limited independently
 * of the display refresh rate. `onActivated` runs exactly once on activation
 * and is never invoked when the request is cancelled or the scheduler is
 * disposed; callers own cancellation through the returned handle.
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

function resetScopeQueue(scope: PreviewActivationScope): void {
	for (const request of Array.from(scope.pendingByKey.values())) {
		settleRequest(request, false);
	}

	scope.pendingByKey.clear();
	scope.pendingQueue = [];
	scope.pendingQueueHead = 0;
}

function resetPreviewActivationSchedulerState(): void {
	const scopesToReset = Array.from(activeQueuedScopes);
	for (const scope of scopesToReset) {
		resetScopeQueue(scope);
	}
	activeQueuedScopes.clear();

	cancelGlobalFrame();
	roundRobinCursor = 0;
	activationTokenState = createEmptyPreviewScheduleTokenState();

	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}

/**
 * Stops activation scheduling and settles all pending activation requests.
 */
export function disposePreviewActivationScheduler(): void {
	resetPreviewActivationSchedulerState();
}

export function resetPreviewActivationSchedulerForTests(): void {
	resetPreviewActivationSchedulerState();
}
