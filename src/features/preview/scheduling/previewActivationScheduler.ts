import {
	isScrollActivityActive,
	subscribeScrollActivity,
} from "infrastructure/scroll/scrollActivity";
import { DEBUG_DISABLE_CARD_DOM_PREVIEW } from "../../../appConstants";

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
	resolve: (activated: boolean) => void;
	settled: boolean;
}

export interface PreviewActivationHandle {
	key: string;
	promise: Promise<boolean>;
	cancel(): void;
}

const defaultScope = createPreviewActivationScope();
const queuesByScope = new Map<
	PreviewActivationScope,
	Map<string, PreviewActivationRequest>
>();
const activeWarmupScopes = new Set<PreviewActivationScope>();
let frameHandle: number | null = null;
let unsubscribeScrollActivity: (() => void) | undefined;

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
		scope.warmupRemainingFrames = Math.max(
			0,
			scope.warmupRemainingFrames - 1,
		);
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

function settleRequest(
	request: PreviewActivationRequest,
	activated: boolean,
): void {
	if (request.settled) return;

	request.settled = true;
	const queue = queuesByScope.get(request.scope);
	if (queue?.get(request.key) === request) {
		queue.delete(request.key);
		if (queue.size === 0) {
			queuesByScope.delete(request.scope);
		}
	}
	request.resolve(activated);
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
	let activated = 0;
	for (const queue of queuesByScope.values()) {
		for (const request of queue.values()) {
			if (hasVisiblePreviewBacklog(request.getVisibleQueueSize)) {
				scheduleFrameDrain();
				return;
			}

			settleRequest(request, true);
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
): PreviewActivationHandle {
	return {
		key,
		promise: Promise.resolve(activated),
		cancel: () => {},
	};
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

export function requestPreviewActivation(
	key: string,
	getVisibleQueueSize: () => number,
	scope: PreviewActivationScope = defaultScope,
): PreviewActivationHandle {
	if (DEBUG_DISABLE_CARD_DOM_PREVIEW) {
		return createSettledActivationHandle(key, false);
	}

	ensureSubscription();
	ensureWarmupStarted(scope);

	if (
		!isWarmupActive(scope) &&
		!isScrollActivityActive() &&
		!hasVisiblePreviewBacklog(getVisibleQueueSize)
	) {
		return createSettledActivationHandle(key, true);
	}

	const queue = getScopeQueue(scope);
	const existing = queue.get(key);
	if (existing) {
		settleRequest(existing, false);
		// settleRequest removes an empty scope queue. Re-register the same queue
		// before installing its replacement request.
		queuesByScope.set(scope, queue);
	}

	let request: PreviewActivationRequest;
	const promise = new Promise<boolean>((resolve) => {
		request = {
			key,
			scope,
			getVisibleQueueSize,
			resolve,
			settled: false,
		};
		queue.set(key, request);
		scheduleFrameDrain();
	});

	return {
		key,
		promise,
		cancel: () => {
			settleRequest(request, false);
		},
	};
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

	if (
		frameHandle !== null &&
		typeof globalThis.cancelAnimationFrame === "function"
	) {
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
