import { describe, expect, test, vi } from "vitest";
import {
	createYieldScheduler,
	defaultYieldToMainThread,
	maybeYield,
	yieldToMainThreadIdleAware,
} from "../timeSlicing";

describe("createYieldScheduler", () => {
	test("requests yield only at cadence boundaries", async () => {
		const now = vi.spyOn(performance, "now").mockReturnValue(0);
		const yieldFn = vi.fn(() => Promise.resolve());
		const scheduler = createYieldScheduler(yieldFn, 0);

		expect(scheduler.checkpoint(0, 64)).toBeUndefined();
		expect(scheduler.checkpoint(63, 64)).toBeUndefined();

		const firstYield = scheduler.checkpoint(64, 64);
		expect(firstYield).toBeInstanceOf(Promise);
		await firstYield;
		expect(yieldFn).toHaveBeenCalledTimes(1);

		expect(scheduler.checkpoint(127, 64)).toBeUndefined();

		const secondYield = scheduler.checkpoint(128, 64);
		expect(secondYield).toBeInstanceOf(Promise);
		await secondYield;
		expect(yieldFn).toHaveBeenCalledTimes(2);

		now.mockRestore();
	});

	test("maybeYield returns undefined when the scheduler does not request a yield", () => {
		const scheduler = {
			checkpoint: vi.fn(() => undefined),
		};

		expect(maybeYield(scheduler, 1, 64)).toBeUndefined();
		expect(scheduler.checkpoint).toHaveBeenCalledWith(1, 64);
	});

	test("yields immediately for pending input and stays responsive for 500ms", async () => {
		const now = vi.spyOn(performance, "now");
		const originalScheduling = Object.getOwnPropertyDescriptor(
			navigator,
			"scheduling",
		);
		try {
			now.mockReturnValue(0);
			const isInputPending = vi.fn(() => true);
			Object.defineProperty(navigator, "scheduling", {
				configurable: true,
				value: { isInputPending },
			});
			const yieldFn = vi.fn(() => Promise.resolve());
			const scheduler = createYieldScheduler(yieldFn, 24);

			now.mockReturnValue(1);
			const inputYield = scheduler.checkpoint(64, 64);
			expect(inputYield).toBeInstanceOf(Promise);
			await inputYield;

			isInputPending.mockReturnValue(false);
			now.mockReturnValue(8);
			expect(scheduler.checkpoint(128, 64)).toBeUndefined();

			now.mockReturnValue(9);
			const responsiveYield = scheduler.checkpoint(192, 64);
			expect(responsiveYield).toBeInstanceOf(Promise);
			await responsiveYield;

			now.mockReturnValue(510);
			const normalModeYield = scheduler.checkpoint(256, 64);
			expect(normalModeYield).toBeInstanceOf(Promise);
			await normalModeYield;

			now.mockReturnValue(526);
			expect(scheduler.checkpoint(320, 64)).toBeUndefined();
			expect(yieldFn).toHaveBeenCalledTimes(3);
		} finally {
			now.mockRestore();
			if (originalScheduling) {
				Object.defineProperty(navigator, "scheduling", originalScheduling);
			} else {
				Reflect.deleteProperty(navigator, "scheduling");
			}
		}
	});
});

describe("defaultYieldToMainThread", () => {
	test("prioritizes requestIdleCallback over scheduler.yield", async () => {
		const originalRequestIdleCallback = window.requestIdleCallback;
		const originalCancelIdleCallback = window.cancelIdleCallback;
		const schedulerYield = vi.fn(() => Promise.resolve());
		const requestIdleCallback = vi.fn(
			(callback: IdleRequestCallback, _options?: IdleRequestOptions) => {
				queueMicrotask(() => {
					callback({ didTimeout: false, timeRemaining: () => 50 });
				});
				return 123;
			},
		);
		const cancelIdleCallback = vi.fn();
		const setTimeoutSpy = vi.spyOn(window, "setTimeout");
		const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

		try {
			vi.stubGlobal("scheduler", { yield: schedulerYield });
			window.requestIdleCallback =
				requestIdleCallback as typeof window.requestIdleCallback;
			window.cancelIdleCallback =
				cancelIdleCallback as typeof window.cancelIdleCallback;

			await expect(
				yieldToMainThreadIdleAware({ maxDelayMs: 25 }),
			).resolves.toBeUndefined();

			expect(requestIdleCallback).toHaveBeenCalledTimes(1);
			expect(schedulerYield).not.toHaveBeenCalled();
			expect(requestIdleCallback.mock.calls[0][1]).toEqual({ timeout: 25 });
			expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
			expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
			expect(cancelIdleCallback).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
			window.requestIdleCallback = originalRequestIdleCallback;
			window.cancelIdleCallback = originalCancelIdleCallback;
			setTimeoutSpy.mockRestore();
			clearTimeoutSpy.mockRestore();
		}
	});

	test("resolves with timeout when requestIdleCallback does not return", async () => {
		vi.useFakeTimers();
		const originalRequestIdleCallback = window.requestIdleCallback;
		const originalCancelIdleCallback = window.cancelIdleCallback;
		const requestIdleCallback = vi.fn(() => 123);
		const cancelIdleCallback = vi.fn();

		try {
			window.requestIdleCallback =
				requestIdleCallback as typeof window.requestIdleCallback;
			window.cancelIdleCallback =
				cancelIdleCallback as typeof window.cancelIdleCallback;

			const promise = yieldToMainThreadIdleAware({ maxDelayMs: 25 });
			await vi.advanceTimersByTimeAsync(25);

			await expect(promise).resolves.toBeUndefined();
			expect(requestIdleCallback).toHaveBeenCalledTimes(1);
			expect(cancelIdleCallback).toHaveBeenCalledWith(123);
		} finally {
			window.requestIdleCallback = originalRequestIdleCallback;
			window.cancelIdleCallback = originalCancelIdleCallback;
			vi.useRealTimers();
		}
	});

	test("falls back to requestAnimationFrame when requestIdleCallback is unavailable", async () => {
		const originalRequestIdleCallback = window.requestIdleCallback;
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const originalCancelAnimationFrame = window.cancelAnimationFrame;
		const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
			queueMicrotask(() => callback(0));
			return 456;
		});
		const cancelAnimationFrame = vi.fn();

		try {
			window.requestIdleCallback =
				undefined as unknown as typeof window.requestIdleCallback;
			window.requestAnimationFrame =
				requestAnimationFrame as typeof window.requestAnimationFrame;
			window.cancelAnimationFrame =
				cancelAnimationFrame as typeof window.cancelAnimationFrame;

			await expect(defaultYieldToMainThread()).resolves.toBeUndefined();

			expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
			expect(cancelAnimationFrame).not.toHaveBeenCalled();
		} finally {
			window.requestIdleCallback = originalRequestIdleCallback;
			window.requestAnimationFrame = originalRequestAnimationFrame;
			window.cancelAnimationFrame = originalCancelAnimationFrame;
		}
	});

	test("MessageChannel fallback waits for completion", async () => {
		const originalRequestIdleCallback = window.requestIdleCallback;
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const originalMessageChannel = globalThis.MessageChannel;
		const port1Close = vi.fn();
		const port2Close = vi.fn();
		const postMessage = vi.fn(() => {
			queueMicrotask(() => {
				channel.port1.onmessage?.({} as MessageEvent);
			});
		});

		const channel = {
			port1: {
				close: port1Close,
				onmessage: undefined as ((event: MessageEvent) => void) | undefined,
			},
			port2: {
				close: port2Close,
				postMessage,
			},
		};

		class MessageChannelMock {
			port1 = channel.port1;
			port2 = channel.port2;
		}

		try {
			window.requestIdleCallback =
				undefined as unknown as typeof window.requestIdleCallback;
			window.requestAnimationFrame =
				undefined as unknown as typeof window.requestAnimationFrame;
			vi.stubGlobal("MessageChannel", MessageChannelMock);

			await expect(defaultYieldToMainThread()).resolves.toBeUndefined();
			expect(postMessage).toHaveBeenCalledTimes(1);
			expect(port1Close).toHaveBeenCalledTimes(1);
			expect(port2Close).toHaveBeenCalledTimes(1);
		} finally {
			window.requestIdleCallback = originalRequestIdleCallback;
			window.requestAnimationFrame = originalRequestAnimationFrame;
			vi.stubGlobal("MessageChannel", originalMessageChannel);
		}
	});

	test("resolves even without browser APIs and MessageChannel", async () => {
		const originalWindow = globalThis.window;
		const originalMessageChannel = globalThis.MessageChannel;

		try {
			vi.stubGlobal("window", undefined);
			vi.stubGlobal("MessageChannel", undefined);

			await expect(defaultYieldToMainThread()).resolves.toBeUndefined();
		} finally {
			vi.stubGlobal("window", originalWindow);
			vi.stubGlobal("MessageChannel", originalMessageChannel);
		}
	});
});
