export const YIELD_CHECK_INTERVAL = 64;
export const HEAVY_YIELD_CHECK_INTERVAL = 128;
const DEFAULT_MAX_YIELD_DELAY_MS = 16;

export interface YieldScheduler {
	checkpoint(iteration: number, cadence: number): Promise<void> | undefined;
}

export type YieldStepGenerator = Generator<Promise<void>, void, void>;

export interface YieldToMainThreadOptions {
	maxDelayMs?: number;
}

function hasWindow(): boolean {
	return typeof window !== "undefined";
}

// Reused across yield calls to avoid allocating a fresh IdleRequestOptions
// object on every pause. requestIdleCallback reads `timeout` synchronously
// before returning, so mutation immediately before the call is safe.
const idleRequestOptions: IdleRequestOptions = { timeout: 0 };

function schedulePause(resolve: () => void, maxDelayMs: number): void {
	if (
		hasWindow() &&
		maxDelayMs > 0 &&
		typeof window.requestIdleCallback === "function"
	) {
		let finished = false;
		let idleId: number | undefined;
		const timeoutId = window.setTimeout(() => {
			if (finished) {
				return;
			}
			finished = true;
			if (idleId !== undefined) {
				window.cancelIdleCallback(idleId);
			}
			resolve();
		}, maxDelayMs);

		idleRequestOptions.timeout = maxDelayMs;
		idleId = window.requestIdleCallback(
			() => {
				if (finished) {
					return;
				}
				finished = true;
				window.clearTimeout(timeoutId);
				resolve();
			},
			idleRequestOptions,
		);
		return;
	}

	if (hasWindow() && typeof window.requestAnimationFrame === "function") {
		window.requestAnimationFrame(() => resolve());
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

	return {
		checkpoint(iteration: number, cadence: number) {
			if (iteration === 0 || (iteration & (cadence - 1)) !== 0) {
				return undefined;
			}

			const now = performance.now();
			if (now - lastYieldTime < yieldIntervalMs) {
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

export async function drainYieldSteps(
	steps: YieldStepGenerator,
): Promise<void> {
	for (const pendingYield of steps) {
		await pendingYield;
	}
}
