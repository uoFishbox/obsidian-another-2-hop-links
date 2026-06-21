import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let originalRequestIdleCallback: Window["requestIdleCallback"] | undefined;

async function loadQueueModule() {
	const module = await import("../renderers/mathRenderQueue");
	return module;
}

beforeEach(() => {
	vi.resetModules();
	originalRequestIdleCallback = window.requestIdleCallback;
});

afterEach(() => {
	window.requestIdleCallback = originalRequestIdleCallback!;
	vi.useRealTimers();
});

describe("enqueueMathRender", () => {
	test("executes via timeout fallback even when requestIdleCallback is not called", async () => {
		vi.useFakeTimers();
		window.requestIdleCallback = vi.fn(() => 1);

		const { enqueueMathRender } = await loadQueueModule();
		let didRun = false;

		const taskPromise = enqueueMathRender(async () => {
			didRun = true;
		});

		expect(didRun).toBe(false);

		await vi.runOnlyPendingTimersAsync();
		expect(didRun).toBe(true);

		await taskPromise;
	});

	test("pending tasks with the same key are replaced by the latest", async () => {
		vi.useFakeTimers();
		const { enqueueMathRender } = await loadQueueModule();
		const events: string[] = [];

		let releaseBlockingTask!: () => void;
		const blockingPromise = new Promise<void>((resolve) => {
			releaseBlockingTask = resolve;
		});

		const firstTask = enqueueMathRender(async () => {
			events.push("first:start");
			await blockingPromise;
			events.push("first:end");
		});

		await vi.advanceTimersByTimeAsync(0);

		const replacedTask = enqueueMathRender(
			async () => {
				events.push("replaced");
			},
			{ key: "card-key" },
		);

		const latestTask = enqueueMathRender(
			async () => {
				events.push("latest");
			},
			{ key: "card-key" },
		);

		releaseBlockingTask();
		await firstTask;

		await vi.advanceTimersByTimeAsync(0);

		await replacedTask;
		await latestTask;

		expect(events).toEqual(["first:start", "first:end", "latest"]);
	});

	test("pending tasks whose AbortSignal has been aborted are not executed", async () => {
		vi.useFakeTimers();
		const { enqueueMathRender } = await loadQueueModule();
		const events: string[] = [];

		let releaseBlockingTask!: () => void;
		const blockingPromise = new Promise<void>((resolve) => {
			releaseBlockingTask = resolve;
		});

		const firstTask = enqueueMathRender(async () => {
			events.push("first:start");
			await blockingPromise;
			events.push("first:end");
		});

		await vi.advanceTimersByTimeAsync(0);

		const controller = new AbortController();
		const abortedTask = enqueueMathRender(
			async () => {
				events.push("aborted");
			},
			{ signal: controller.signal },
		);

		controller.abort();
		releaseBlockingTask();

		await firstTask;
		await vi.advanceTimersByTimeAsync(0);
		await abortedTask;

		expect(events).toEqual(["first:start", "first:end"]);
	});

	test("scheduled tasks waiting for idle callback are resolved by clear and not executed", async () => {
		vi.useFakeTimers();
		let idleCallback: IdleRequestCallback | undefined;
		window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
			idleCallback = callback;
			return 1;
		}) as Window["requestIdleCallback"];

		const { clearMathRenderQueue, enqueueMathRender } = await loadQueueModule();
		const task = vi.fn(async () => {});

		const taskPromise = enqueueMathRender(task);
		let didSettle = false;
		void taskPromise.then(() => {
			didSettle = true;
		});

		clearMathRenderQueue();
		await Promise.resolve();

		expect(didSettle).toBe(true);
		expect(task).not.toHaveBeenCalled();

		idleCallback?.({
			didTimeout: false,
			timeRemaining: () => 50,
		});
		await vi.runOnlyPendingTimersAsync();

		expect(task).not.toHaveBeenCalled();
		await taskPromise;
	});
});
