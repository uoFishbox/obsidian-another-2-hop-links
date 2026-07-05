import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "infrastructure/scroll/scrollActivity";
import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";

const SCROLLING_MAX_ACTIVATIONS_PER_FRAME = 2;
const IDLE_MAX_ACTIVATIONS_PER_FRAME = 6;
const BACKPRESSURE_MAX_ACTIVATIONS_PER_FRAME = 1;
/**
 * Number of animation frames after the first activation request during which
 * idle/no-backlog requests are forced through the queued drain path.
 */
const WARMUP_FRAMES = 2;

export interface PreviewBackpressure {
	readonly queued: number;
	readonly active: number;
}

export interface PreviewBackpressureProvider {
	readonly getQueuedPreviewJobs: () => number;
	readonly getActivePreviewJobs?: () => number;
}

export interface PreviewActivationScope {
	warmupStarted: boolean;
	warmupRemainingFrames: number;
	warmupFrameHandle: number | null;
	pendingByKey: Map<string, PreviewActivationRequest>;
	pendingQueue: PreviewActivationRequest[];
	pendingQueueHead: number;
	frameHandle: number | null;
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
const activeWarmupScopes = new Set<PreviewActivationScope>();
const scheduledFrameScopes = new Set<PreviewActivationScope>();
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

function getEmptyBackpressure(): PreviewBackpressure {
	return { queued: 0, active: 0 };
}

export function createPreviewActivationScope(
	options: CreatePreviewActivationScopeOptions = {},
): PreviewActivationScope {
	return {
		warmupStarted: false,
		warmupRemainingFrames: 0,
		warmupFrameHandle: null,
		pendingByKey: new Map<string, PreviewActivationRequest>(),
		pendingQueue: [],
		pendingQueueHead: 0,
		frameHandle: null,
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

function isWarmupActive(scope: PreviewActivationScope): boolean {
	return scope.warmupRemainingFrames > 0;
}

function scheduleWarmupCountdown(scope: PreviewActivationScope): void {
	if (scope.warmupFrameHandle !== null) return;

	if (typeof globalThis.requestAnimationFrame !== "function") {
		scope.warmupRemainingFrames = 0;
		activeWarmupScopes.delete(scope);
		return;
	}

	activeWarmupScopes.add(scope);
	scope.warmupFrameHandle = globalThis.requestAnimationFrame(() => {
		scope.warmupFrameHandle = null;
		scope.warmupRemainingFrames = Math.max(0, scope.warmupRemainingFrames - 1);
		if (scope.warmupRemainingFrames > 0) {
			scheduleWarmupCountdown(scope);
			return;
		}
		activeWarmupScopes.delete(scope);
	});
}

function ensureWarmupStarted(scope: PreviewActivationScope): void {
	if (scope.warmupStarted) return;

	scope.warmupStarted = true;
	scope.warmupRemainingFrames = WARMUP_FRAMES;
	scheduleWarmupCountdown(scope);
}

function hasVisiblePreviewBacklog(getVisibleQueueSize: () => number): boolean {
	return getVisibleQueueSize() > 0;
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

	unsubscribeScrollActivity = subscribeScrollActivity((active) => {
		if (!active) {
			drainAllActiveScopes();
			return;
		}
		for (const scope of activeQueuedScopes) {
			scheduleScopeFrameDrain(scope);
		}
	});
}

function scheduleScopeFrameDrain(scope: PreviewActivationScope): void {
	if (
		scope.frameHandle !== null ||
		typeof globalThis.requestAnimationFrame !== "function"
	) {
		return;
	}

	scheduledFrameScopes.add(scope);
	scope.frameHandle = globalThis.requestAnimationFrame(() => {
		scheduledFrameScopes.delete(scope);
		scope.frameHandle = null;
		drainScopeFrame(scope);
	});
}

function drainAllActiveScopes(): void {
	for (const scope of Array.from(activeQueuedScopes)) {
		drainScopeFrame(scope);
	}
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

function resolveActivationBudget(params: {
	readonly isScrolling: boolean;
	readonly queuedPreviewJobs: number;
	readonly activePreviewJobs: number;
}): number {
	if (params.queuedPreviewJobs > 0 || params.activePreviewJobs > 0) {
		return BACKPRESSURE_MAX_ACTIVATIONS_PER_FRAME;
	}

	return params.isScrolling
		? SCROLLING_MAX_ACTIVATIONS_PER_FRAME
		: IDLE_MAX_ACTIVATIONS_PER_FRAME;
}

function compactScopeQueue(scope: PreviewActivationScope): void {
	if (
		scope.pendingQueueHead < 64 &&
		scope.pendingQueue.length <= scope.pendingByKey.size * 2 + 16
	) {
		return;
	}

	scope.pendingQueue = scope.pendingQueue.slice(scope.pendingQueueHead).filter(
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

function drainScopeFrame(scope: PreviewActivationScope): void {
	if (scope.pendingByKey.size === 0) {
		activeQueuedScopes.delete(scope);
		return;
	}

	const pressure = readScopeBackpressure(scope);
	const activationBudget = resolveActivationBudget({
		isScrolling: isScrollActivityActive(),
		queuedPreviewJobs: pressure.queued,
		activePreviewJobs: pressure.active,
	});
	let activated = 0;

	while (activated < activationBudget) {
		const request = readNextQueuedRequest(scope);
		if (!request) break;
		if (request.settled) continue;
		if (scope.pendingByKey.get(request.key) !== request) continue;

		settleRequest(request, true);
		activated += 1;
	}

	compactScopeQueue(scope);

	if (scope.pendingByKey.size > 0) {
		scheduleScopeFrameDrain(scope);
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

	ensureWarmupStarted(scope);
	const pressure = readScopeBackpressure(scope);
	return (
		!isWarmupActive(scope) &&
		!isScrollActivityActive() &&
		!hasVisiblePreviewBacklog(() => pressure.queued)
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
	scheduleScopeFrameDrain(scope);

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

	ensureWarmupStarted(scope);
	const pressure = readScopeBackpressure(scope);
	if (
		!isWarmupActive(scope) &&
		!isScrollActivityActive() &&
		!hasVisiblePreviewBacklog(() => pressure.queued)
	) {
		return createSettledActivationHandle(key, true, onSettled);
	}

	return enqueuePreviewActivationRequest(key, scope, onSettled);
}

/**
 * Requests activation strictly through the frame-budgeted queue.
 *
 * Unlike {@link requestPreviewActivation}, this never activates synchronously,
 * even when the scheduler is idle and warmed up. This is intended for bulk
 * row-visible activations where multiple cards become visible at once and
 * must be spread across frames.
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

export function resetPreviewActivationSchedulerForTests(): void {
	const scopesToReset = new Set([
		...Array.from(activeQueuedScopes),
		...Array.from(scheduledFrameScopes),
	]);

	for (const scope of scopesToReset) {
		for (const request of Array.from(scope.pendingByKey.values())) {
			settleRequest(request, false);
		}

		if (
			scope.frameHandle !== null &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(scope.frameHandle);
		}
		scope.frameHandle = null;
		scope.pendingByKey.clear();
		scope.pendingQueue = [];
		scope.pendingQueueHead = 0;
	}
	activeQueuedScopes.clear();
	scheduledFrameScopes.clear();

	for (const scope of activeWarmupScopes) {
		if (
			scope.warmupFrameHandle !== null &&
			typeof globalThis.cancelAnimationFrame === "function"
		) {
			globalThis.cancelAnimationFrame(scope.warmupFrameHandle);
		}
		scope.warmupFrameHandle = null;
		scope.warmupStarted = false;
		scope.warmupRemainingFrames = 0;
	}
	activeWarmupScopes.clear();
	defaultScope.warmupStarted = false;
	defaultScope.warmupRemainingFrames = 0;
	defaultScope.warmupFrameHandle = null;
	defaultScope.pendingByKey.clear();
	defaultScope.pendingQueue = [];
	defaultScope.pendingQueueHead = 0;
	defaultScope.frameHandle = null;
	defaultScope.backpressureProviders.clear();

	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}
