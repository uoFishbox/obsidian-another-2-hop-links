import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "infrastructure/scroll/scrollActivity";
import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";

const WARMUP_MS = 32;
const MAX_REFILL_ELAPSED_MS = 250;
const MAX_QUEUE_ENTRIES_PER_DRAIN = 256;
const ACTIVATION_TOKEN_EPSILON = 1e-9;

interface PreviewActivationPolicy {
	readonly activationsPerSecond: number;
	readonly burstCapacity: number;
	readonly maxDrainCpuMs: number;
}

const SCROLLING_POLICY: PreviewActivationPolicy = {
	activationsPerSecond: 60,
	burstCapacity: 1,
	maxDrainCpuMs: 1,
};
const IDLE_POLICY: PreviewActivationPolicy = {
	activationsPerSecond: 120,
	burstCapacity: 2,
	maxDrainCpuMs: 2,
};
const BACKPRESSURED_POLICY: PreviewActivationPolicy = {
	activationsPerSecond: 30,
	burstCapacity: 1,
	maxDrainCpuMs: 1,
};

export interface PreviewBackpressure {
	readonly queued: number;
	readonly active: number;
}

export interface PreviewBackpressureProvider {
	readonly getQueuedPreviewJobs: () => number;
	readonly getActivePreviewJobs?: () => number;
}

export interface PreviewActivationScope {
	warmupUntil: number | null;
	pendingByKey: Map<string, PreviewActivationRequest>;
	pendingQueue: PreviewActivationRequest[];
	pendingQueueHead: number;
	getBackpressure: () => PreviewBackpressure;
	backpressureProviders: Map<() => number, PreviewBackpressureProviderRegistration>;
}

interface PreviewActivationRequest {
	key: string;
	scope: PreviewActivationScope;
	onSettled: ((activated: boolean) => void) | undefined;
	settled: boolean;
}

interface PreviewBackpressureProviderRegistration {
	provider: PreviewBackpressureProvider;
	refCount: number;
}

export interface CreatePreviewActivationScopeOptions {
	readonly getBackpressure?: () => PreviewBackpressure;
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

const defaultScope = createPreviewActivationScope();
const activeQueuedScopes = new Set<PreviewActivationScope>();
let globalFrameHandle: number | null = null;
let roundRobinCursor = 0;
let availableActivationTokens = 0;
let lastTokenRefillTimestamp: number | null = null;
let unsubscribeScrollActivity: (() => void) | undefined;

function cancelHandle(this: PreviewActivationHandleInternal): void {
	const request = this[ACTIVATION_REQUEST];
	if (request) {
		settleRequest(request, false);
	}
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

function invokeSettlementCallback(
	onSettled: ((activated: boolean) => void) | undefined,
	activated: boolean,
): void {
	try {
		onSettled?.(activated);
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
		warmupUntil: null,
		pendingByKey: new Map<string, PreviewActivationRequest>(),
		pendingQueue: [],
		pendingQueueHead: 0,
		getBackpressure: options.getBackpressure ?? getEmptyBackpressure,
		backpressureProviders: new Map<
			() => number,
			PreviewBackpressureProviderRegistration
		>(),
	};
}

export function registerPreviewActivationBackpressure(
	scope: PreviewActivationScope,
	provider: PreviewBackpressureProvider,
): () => void {
	const existing = scope.backpressureProviders.get(provider.getQueuedPreviewJobs);
	if (existing) {
		existing.refCount += 1;
		return () => unregisterPreviewActivationBackpressure(scope, provider);
	}

	scope.backpressureProviders.set(provider.getQueuedPreviewJobs, {
		provider,
		refCount: 1,
	});
	return () => unregisterPreviewActivationBackpressure(scope, provider);
}

function unregisterPreviewActivationBackpressure(
	scope: PreviewActivationScope,
	provider: PreviewBackpressureProvider,
): void {
	const registration = scope.backpressureProviders.get(provider.getQueuedPreviewJobs);
	if (!registration) return;

	registration.refCount -= 1;
	if (registration.refCount > 0) return;

	scope.backpressureProviders.delete(provider.getQueuedPreviewJobs);
}

function ensureWarmupStarted(
	scope: PreviewActivationScope,
	now = readMonotonicTime(),
): void {
	if (scope.warmupUntil !== null) return;
	scope.warmupUntil = now + WARMUP_MS;
}

function isWarmupActive(
	scope: PreviewActivationScope,
	now = readMonotonicTime(),
): boolean {
	return scope.warmupUntil !== null && now < scope.warmupUntil;
}

function settleRequest(request: PreviewActivationRequest, activated: boolean): void {
	if (request.settled) return;

	request.settled = true;
	if (request.scope.pendingByKey.get(request.key) === request) {
		request.scope.pendingByKey.delete(request.key);
	}
	if (request.scope.pendingByKey.size === 0) {
		activeQueuedScopes.delete(request.scope);
	}
	invokeSettlementCallback(request.onSettled, activated);
}

function ensureSubscription(): void {
	if (unsubscribeScrollActivity) return;

	unsubscribeScrollActivity = subscribeScrollActivity(() => {
		scheduleGlobalFrameDrain();
	});
}

function scheduleGlobalFrameDrain(): void {
	if (
		globalFrameHandle !== null ||
		activeQueuedScopes.size === 0 ||
		typeof globalThis.requestAnimationFrame !== "function"
	) {
		return;
	}

	globalFrameHandle = globalThis.requestAnimationFrame((timestamp) => {
		globalFrameHandle = null;
		drainGlobalFrame(timestamp);
	});
}

function readScopeBackpressure(scope: PreviewActivationScope): PreviewBackpressure {
	let pressure = scope.getBackpressure();
	let queued = pressure.queued;
	let active = pressure.active;

	for (const registration of scope.backpressureProviders.values()) {
		queued = Math.max(queued, registration.provider.getQueuedPreviewJobs());
		active = Math.max(active, registration.provider.getActivePreviewJobs?.() ?? 0);
	}

	return { queued, active };
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
	readonly isScrolling: boolean;
	readonly queuedPreviewJobs: number;
	readonly activePreviewJobs: number;
}): PreviewActivationPolicy {
	if (params.queuedPreviewJobs > 0 || params.activePreviewJobs > 0) {
		return BACKPRESSURED_POLICY;
	}

	return params.isScrolling ? SCROLLING_POLICY : IDLE_POLICY;
}

function refillActivationTokens(
	timestamp: number,
	policy: PreviewActivationPolicy,
): void {
	if (lastTokenRefillTimestamp === null) {
		lastTokenRefillTimestamp = timestamp;
		availableActivationTokens = policy.burstCapacity;
		return;
	}

	const elapsedMs = Math.min(
		MAX_REFILL_ELAPSED_MS,
		Math.max(0, timestamp - lastTokenRefillTimestamp),
	);
	lastTokenRefillTimestamp = timestamp;
	availableActivationTokens = Math.min(
		policy.burstCapacity,
		availableActivationTokens + (elapsedMs * policy.activationsPerSecond) / 1000,
	);
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

	const pressure = readGlobalBackpressure();
	const policy = resolveActivationPolicy({
		isScrolling: isScrollActivityActive(),
		queuedPreviewJobs: pressure.queued,
		activePreviewJobs: pressure.active,
	});
	refillActivationTokens(frameTimestamp, policy);

	const scopes = Array.from(activeQueuedScopes);
	const deadline = readMonotonicTime() + policy.maxDrainCpuMs;
	let inspectedQueueEntries = 0;

	while (
		availableActivationTokens + ACTIVATION_TOKEN_EPSILON >= 1 &&
		inspectedQueueEntries < MAX_QUEUE_ENTRIES_PER_DRAIN &&
		readMonotonicTime() <= deadline
	) {
		const request = readNextRoundRobinRequest(scopes);
		if (!request) break;
		inspectedQueueEntries += 1;
		if (request.settled) continue;
		if (request.scope.pendingByKey.get(request.key) !== request) continue;

		settleRequest(request, true);
		availableActivationTokens = Math.max(0, availableActivationTokens - 1);
	}

	for (const scope of scopes) {
		compactScopeQueue(scope);
	}

	if (activeQueuedScopes.size > 0) {
		scheduleGlobalFrameDrain();
	}
}

function createSettledActivationHandle(
	key: string,
	activated: boolean,
	onSettled: ((activated: boolean) => void) | undefined,
): PreviewActivationHandle {
	const handle = createActivationHandle(key, undefined);
	invokeSettlementCallback(onSettled, activated);
	return handle;
}

export function canActivatePreviewImmediately(
	scope: PreviewActivationScope = defaultScope,
): boolean {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) return false;

	const now = readMonotonicTime();
	ensureWarmupStarted(scope, now);
	const pressure = readScopeBackpressure(scope);
	return (
		!isWarmupActive(scope, now) &&
		!isScrollActivityActive() &&
		pressure.queued <= 0 &&
		pressure.active <= 0
	);
}

/**
 * Requests activation and reports the result exactly once.
 *
 * `onSettled` can run before this function returns when the result is already
 * known, so callers must not assume the returned handle has been assigned.
 */
function enqueuePreviewActivationRequest(
	key: string,
	scope: PreviewActivationScope,
	onSettled: ((activated: boolean) => void) | undefined,
): PreviewActivationHandle {
	ensureSubscription();
	ensureWarmupStarted(scope);

	const existing = scope.pendingByKey.get(key);
	if (existing) {
		settleRequest(existing, false);
	}

	const request: PreviewActivationRequest = {
		key,
		scope,
		onSettled,
		settled: false,
	};
	scope.pendingByKey.set(key, request);
	scope.pendingQueue.push(request);
	activeQueuedScopes.add(scope);
	scheduleGlobalFrameDrain();

	return createActivationHandle(key, request);
}

/**
 * Requests activation and reports the result exactly once.
 *
 * `onSettled` can run before this function returns when the result is already
 * known, so callers must not assume the returned handle has been assigned.
 */
export function requestPreviewActivation(
	key: string,
	scope: PreviewActivationScope = defaultScope,
	onSettled?: (activated: boolean) => void,
): PreviewActivationHandle {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
		return createSettledActivationHandle(key, false, onSettled);
	}

	const now = readMonotonicTime();
	ensureWarmupStarted(scope, now);
	const pressure = readScopeBackpressure(scope);
	if (
		!isWarmupActive(scope, now) &&
		!isScrollActivityActive() &&
		pressure.queued <= 0 &&
		pressure.active <= 0
	) {
		return createSettledActivationHandle(key, true, onSettled);
	}

	return enqueuePreviewActivationRequest(key, scope, onSettled);
}

/**
 * Requests activation strictly through the time-budgeted queue.
 *
 * Unlike {@link requestPreviewActivation}, this never activates synchronously,
 * even when the scheduler is idle and warmed up. This is intended for bulk
 * row-visible activations where multiple cards become visible at once and
 * must be rate-limited independently of the display refresh rate.
 */
export function requestQueuedPreviewActivation(
	key: string,
	scope: PreviewActivationScope = defaultScope,
	onSettled?: (activated: boolean) => void,
): PreviewActivationHandle {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
		return createSettledActivationHandle(key, false, onSettled);
	}

	return enqueuePreviewActivationRequest(key, scope, onSettled);
}

export function cancelPreviewActivation(
	key: string,
	scope: PreviewActivationScope = defaultScope,
): void {
	const request = scope.pendingByKey.get(key);
	if (request) {
		settleRequest(request, false);
	}
}

function resetScopeQueue(scope: PreviewActivationScope): void {
	for (const request of Array.from(scope.pendingByKey.values())) {
		settleRequest(request, false);
	}

	scope.warmupUntil = null;
	scope.pendingByKey.clear();
	scope.pendingQueue = [];
	scope.pendingQueueHead = 0;
}

export function resetPreviewActivationSchedulerForTests(): void {
	const scopesToReset = Array.from(activeQueuedScopes);
	for (const scope of scopesToReset) {
		resetScopeQueue(scope);
	}
	activeQueuedScopes.clear();

	if (
		globalFrameHandle !== null &&
		typeof globalThis.cancelAnimationFrame === "function"
	) {
		globalThis.cancelAnimationFrame(globalFrameHandle);
	}
	globalFrameHandle = null;
	roundRobinCursor = 0;
	availableActivationTokens = 0;
	lastTokenRefillTimestamp = null;

	resetScopeQueue(defaultScope);
	defaultScope.backpressureProviders.clear();

	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}
