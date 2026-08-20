export const YIELD_CHECK_INTERVAL = 64;
export const HEAVY_YIELD_CHECK_INTERVAL = 128;
const DEFAULT_MAX_YIELD_DELAY_MS = 16;
const RESPONSIVE_YIELD_INTERVAL_MS = 8;
const RESPONSIVE_MODE_DURATION_MS = 500;

interface BrowserScheduling {
	isInputPending?: (options?: { includeContinuous?: boolean }) => boolean;
}

export interface YieldScheduler {
	checkpoint(iteration: number, cadence: number): Promise<void> | undefined;
}

export type YieldStepGenerator<T = void> = Generator<Promise<void>, T, void>;

export interface YieldToMainThreadOptions {
	maxDelayMs?: number;
}

type YieldSchedulingWindowResolver = () => Window | null;
let yieldSchedulingWindowResolver: YieldSchedulingWindowResolver | null = null;

/**
 * Binds background cooperative scheduling to the workspace realm currently
 * receiving input. Returns a scoped reset function for plugin teardown/tests.
 */
export function setYieldSchedulingWindowResolver(
	resolver: YieldSchedulingWindowResolver | null,
): () => void {
	const previous = yieldSchedulingWindowResolver;
	yieldSchedulingWindowResolver = resolver;
	return () => {
		if (yieldSchedulingWindowResolver === resolver) {
			yieldSchedulingWindowResolver = previous;
		}
	};
}

function resolveSchedulingWindow(): Window | null {
	return (
		yieldSchedulingWindowResolver?.() ??
		(typeof window === "undefined" ? null : window)
	);
}

/** Returns whether the browser reports queued discrete or continuous input. */
export function hasPendingBrowserInput(): boolean {
	const ownerNavigator =
		resolveSchedulingWindow()?.navigator ??
		(typeof navigator === "undefined" ? null : navigator);
	if (!ownerNavigator) {
		return false;
	}

	const scheduling = (
		ownerNavigator as Navigator & {
			scheduling?: BrowserScheduling;
		}
	).scheduling;
	return scheduling?.isInputPending?.({ includeContinuous: true }) ?? false;
}

const idleRequestOptions: IdleRequestOptions = { timeout: 0 };

function schedulePause(resolve: () => void, maxDelayMs: number): void {
	const ownerWindow = resolveSchedulingWindow();
	if (
		ownerWindow &&
		maxDelayMs > 0 &&
		typeof ownerWindow.requestIdleCallback === "function"
	) {
		let finished = false;
		let idleId: number | undefined;
		const timeoutId = ownerWindow.setTimeout(() => {
			if (finished) {
				return;
			}
			finished = true;
			if (idleId !== undefined) {
				ownerWindow.cancelIdleCallback(idleId);
			}
			resolve();
		}, maxDelayMs);

		idleRequestOptions.timeout = maxDelayMs;
		idleId = ownerWindow.requestIdleCallback(() => {
			if (finished) {
				return;
			}
			finished = true;
			ownerWindow.clearTimeout(timeoutId);
			resolve();
		}, idleRequestOptions);
		return;
	}

	if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
		ownerWindow.requestAnimationFrame(() => resolve());
		return;
	}

	if (typeof MessageChannel === "function") {
		const channel = new MessageChannel();
		let finished = false;
		channel.port1.onmessage = () => {
			if (finished) {
				return;
			}
			finished = true;
			channel.port1.close();
			channel.port2.close();
			resolve();
		};
		channel.port2.postMessage(null);
		return;
	}

	queueMicrotask(resolve);
}

export function yieldToMainThreadIdleAware(
	options: YieldToMainThreadOptions = {},
): Promise<void> {
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_YIELD_DELAY_MS;

	return new Promise((resolve) => {
		schedulePause(resolve, maxDelayMs);
	});
}

export function defaultYieldToMainThread(): Promise<void> {
	return yieldToMainThreadIdleAware();
}

export function createYieldScheduler(
	yieldFn: () => Promise<void>,
	yieldIntervalMs: number,
): YieldScheduler {
	let lastYieldTime = performance.now();
	let responsiveUntil = 0;

	return {
		checkpoint(iteration: number, cadence: number) {
			if (iteration === 0 || (iteration & (cadence - 1)) !== 0) {
				return undefined;
			}

			const now = performance.now();
			const inputPending = hasPendingBrowserInput();
			if (inputPending) {
				responsiveUntil = now + RESPONSIVE_MODE_DURATION_MS;
			}

			const effectiveYieldIntervalMs =
				now < responsiveUntil
					? Math.min(yieldIntervalMs, RESPONSIVE_YIELD_INTERVAL_MS)
					: yieldIntervalMs;
			if (!inputPending && now - lastYieldTime < effectiveYieldIntervalMs) {
				return undefined;
			}

			return yieldFn().then(() => {
				lastYieldTime = performance.now();
			});
		},
	};
}

export function maybeYield(
	yieldScheduler: YieldScheduler,
	iteration: number,
	cadence: number,
): Promise<void> | undefined {
	return yieldScheduler.checkpoint(iteration, cadence);
}

/** Awaits every cooperative yield and returns the generator's final value. */
export async function drainYieldSteps<T>(steps: YieldStepGenerator<T>): Promise<T> {
	let step = steps.next();
	while (!step.done) {
		await step.value;
		step = steps.next();
	}
	return step.value;
}
