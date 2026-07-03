import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "infrastructure/scroll/scrollActivity";
import { DEBUG_DISABLE_CARD_DOM_PREVIEW, IS_PROD } from "../../../appConstants";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

const ACTIVATION_FRAME_BUDGET = 2;
/**
 * Number of animation frames after the first activation request during which
 * idle/no-backlog requests are forced through the queued drain path.
 */
const WARMUP_FRAMES = 2;

export interface PreviewActivationScope {
	warmupStarted: boolean;
	warmupRemainingFrames: number;
	warmupFrameHandle: number | null;
}

interface PreviewActivationRequest {
	key: string;
	scope: PreviewActivationScope;
	getVisibleQueueSize: () => number;
	onSettled: ((activated: boolean) => void) | undefined;
	settled: boolean;
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
const queuesByScope = new Map<
	PreviewActivationScope,
	Map<string, PreviewActivationRequest>
>();
const activeWarmupScopes = new Set<PreviewActivationScope>();
let frameHandle: number | null = null;
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

export function createPreviewActivationScope(): PreviewActivationScope {
	return {
		warmupStarted: false,
		warmupRemainingFrames: 0,
		warmupFrameHandle: null,
	};
}

function getScopeQueue(
	scope: PreviewActivationScope,
): Map<string, PreviewActivationRequest> {
	const existing = queuesByScope.get(scope);
	if (existing) return existing;

	const queue = new Map<string, PreviewActivationRequest>();
	queuesByScope.set(scope, queue);
	return queue;
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
	const queue = queuesByScope.get(request.scope);
	if (queue?.get(request.key) === request) {
		queue.delete(request.key);
		if (queue.size === 0) {
			queuesByScope.delete(request.scope);
		}
	}
	invokeSettlementCallback(request.onSettled, activated);
}

function ensureSubscription(): void {
	if (unsubscribeScrollActivity) return;

	unsubscribeScrollActivity = subscribeScrollActivity((active) => {
		if (!active) {
			drainFrame();
			return;
		}
		scheduleFrameDrain();
	});
}

function scheduleFrameDrain(): void {
	if (
		frameHandle !== null ||
		typeof globalThis.requestAnimationFrame !== "function"
	) {
		return;
	}

	frameHandle = globalThis.requestAnimationFrame(() => {
		frameHandle = null;
		drainFrame();
	});
}

function drainFrame(): void {
	let isScrollActive = false;
	if (!IS_PROD) {
		recordCCLDevMeasurement("PreviewActivationScheduler.drainFrame");
		isScrollActive = isScrollActivityActive();
		if (isScrollActive) {
			recordCCLDevMeasurement(
				"PreviewActivationScheduler.drainFrame.duringScroll",
			);
		}
	}

	let activated = 0;
	for (const queue of queuesByScope.values()) {
		for (const request of queue.values()) {
			if (hasVisiblePreviewBacklog(request.getVisibleQueueSize)) {
				if (!IS_PROD) {
					recordCCLDevMeasurement(
						"PreviewActivationScheduler.drainFrame.skipBacklog",
					);
				}
				scheduleFrameDrain();
				return;
			}

			settleRequest(request, true);
			if (!IS_PROD) {
				recordCCLDevMeasurement(
					"PreviewActivationScheduler.drainFrame.activated",
				);
				if (isScrollActive) {
					recordCCLDevMeasurement(
						"PreviewActivationScheduler.drainFrame.activatedDuringScroll",
					);
				}
			}
			activated += 1;
			if (activated >= ACTIVATION_FRAME_BUDGET) break;
		}
		if (activated >= ACTIVATION_FRAME_BUDGET) break;
	}

	if (queuesByScope.size > 0) {
		scheduleFrameDrain();
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
	getVisibleQueueSize: () => number,
	scope: PreviewActivationScope = defaultScope,
): boolean {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) return false;

	ensureWarmupStarted(scope);
	return (
		!isWarmupActive(scope) &&
		!isScrollActivityActive() &&
		!hasVisiblePreviewBacklog(getVisibleQueueSize)
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
	getVisibleQueueSize: () => number,
	scope: PreviewActivationScope,
	onSettled: ((activated: boolean) => void) | undefined,
): PreviewActivationHandle {
	if (!IS_PROD) {
		recordCCLDevMeasurement("PreviewActivationScheduler.enqueue");
		if (isScrollActivityActive()) {
			recordCCLDevMeasurement("PreviewActivationScheduler.enqueue.duringScroll");
		}
	}

	ensureSubscription();
	ensureWarmupStarted(scope);

	const queue = getScopeQueue(scope);
	const existing = queue.get(key);
	if (existing) {
		settleRequest(existing, false);
		// settleRequest removes an empty scope queue. Re-register the same queue
		// before installing its replacement request.
		queuesByScope.set(scope, queue);
	}

	const request: PreviewActivationRequest = {
		key,
		scope,
		getVisibleQueueSize,
		onSettled,
		settled: false,
	};
	queue.set(key, request);
	scheduleFrameDrain();

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
	getVisibleQueueSize: () => number,
	scope: PreviewActivationScope = defaultScope,
	onSettled?: (activated: boolean) => void,
): PreviewActivationHandle {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
		return createSettledActivationHandle(key, false, onSettled);
	}

	ensureWarmupStarted(scope);
	if (
		!isWarmupActive(scope) &&
		!isScrollActivityActive() &&
		!hasVisiblePreviewBacklog(getVisibleQueueSize)
	) {
		return createSettledActivationHandle(key, true, onSettled);
	}

	return enqueuePreviewActivationRequest(key, getVisibleQueueSize, scope, onSettled);
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
	getVisibleQueueSize: () => number,
	scope: PreviewActivationScope = defaultScope,
	onSettled?: (activated: boolean) => void,
): PreviewActivationHandle {
	if (!IS_PROD) {
		recordCCLDevMeasurement("PreviewActivationScheduler.requestQueued");
		if (isScrollActivityActive()) {
			recordCCLDevMeasurement(
				"PreviewActivationScheduler.requestQueued.duringScroll",
			);
		}
	}

	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
		return createSettledActivationHandle(key, false, onSettled);
	}

	return enqueuePreviewActivationRequest(key, getVisibleQueueSize, scope, onSettled);
}

export function cancelPreviewActivation(key: string): void {
	const request = queuesByScope.get(defaultScope)?.get(key);
	if (request) {
		settleRequest(request, false);
	}
}

export function resetPreviewActivationSchedulerForTests(): void {
	for (const queue of Array.from(queuesByScope.values())) {
		for (const request of Array.from(queue.values())) {
			settleRequest(request, false);
		}
	}
	queuesByScope.clear();

	if (frameHandle !== null && typeof globalThis.cancelAnimationFrame === "function") {
		globalThis.cancelAnimationFrame(frameHandle);
	}
	frameHandle = null;

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

	unsubscribeScrollActivity?.();
	unsubscribeScrollActivity = undefined;
}
