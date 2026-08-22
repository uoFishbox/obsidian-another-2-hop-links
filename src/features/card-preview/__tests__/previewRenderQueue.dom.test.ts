import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function createDeferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
}

function createSchedulingWindow(params: {
	requestAnimationFrame: (callback: FrameRequestCallback) => number;
	cancelAnimationFrame?: (handle: number) => void;
}): Window {
	return {
		requestAnimationFrame: params.requestAnimationFrame,
		cancelAnimationFrame: params.cancelAnimationFrame ?? vi.fn(),
	} as unknown as Window;
}

async function loadQueueModule() {
	return import("../renderers/previewRenderQueue");
}

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("createPreviewRenderQueue", () => {
	test("schedules preview rendering on the next animation frame", async () => {
		const requestIdleCallback = vi.spyOn(window, "requestIdleCallback");
		const { createPreviewRenderQueue } = await loadQueueModule();
		const { getCCLDevMeasurementSnapshot } =
			await import("infrastructure/debug/CCLDevMeasurements");
		const queue = createPreviewRenderQueue();

		const result = queue.enqueue(async () => "rendered");
		await vi.runAllTimersAsync();

		await expect(result).resolves.toBe("rendered");
		expect(requestIdleCallback).not.toHaveBeenCalled();
		expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledTimes(1);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"preview.renderScheduler.animationFrame"
			].count,
		).toBe(1);
		queue.dispose();
	});

	test("serializes tasks within the same owner window", async () => {
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const releaseFirst = createDeferred();
		const events: string[] = [];

		const first = queue.enqueue(async () => {
			events.push("first:start");
			await releaseFirst.promise;
			events.push("first:end");
			return "first";
		});
		const second = queue.enqueue(async () => {
			events.push("second");
			return "second";
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(events).toEqual(["first:start"]);

		releaseFirst.resolve();
		await expect(first).resolves.toBe("first");
		await expect(second).resolves.toBe("second");
		expect(events).toEqual(["first:start", "first:end", "second"]);
		expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledTimes(1);
		queue.dispose();
	});

	test("aborts a frame-scheduled task immediately", async () => {
		const requestFrame = vi.fn(() => 41);
		const cancelFrame = vi.fn();
		const ownerWindow = createSchedulingWindow({
			requestAnimationFrame: requestFrame,
			cancelAnimationFrame: cancelFrame,
		});
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const controller = new AbortController();
		const run = vi.fn(async () => "unexpected");
		const result = queue.enqueue(run, controller.signal, ownerWindow);
		const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });

		controller.abort();

		await rejection;
		expect(run).not.toHaveBeenCalled();
		expect(cancelFrame).toHaveBeenCalledWith(41);
		queue.dispose();
	});

	test("aborted pending tasks reject before the running task finishes", async () => {
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const releaseFirst = createDeferred();
		const controller = new AbortController();
		const events: string[] = [];

		const first = queue.enqueue(async () => {
			events.push("first:start");
			await releaseFirst.promise;
			events.push("first:end");
		});
		const aborted = queue.enqueue(async () => {
			events.push("aborted");
		}, controller.signal);
		const rejection = expect(aborted).rejects.toMatchObject({ name: "AbortError" });

		await vi.advanceTimersByTimeAsync(0);
		expect(events).toEqual(["first:start"]);

		controller.abort();
		await rejection;
		expect(events).toEqual(["first:start"]);

		releaseFirst.resolve();
		await first;
		expect(events).toEqual(["first:start", "first:end"]);
		queue.dispose();
	});

	test("a stalled owner window does not block another window partition", async () => {
		const stalledRequestFrame = vi.fn(() => 10);
		const activeRequestFrame = vi.fn(
			(callback: FrameRequestCallback) =>
				setTimeout(() => callback(0), 0) as unknown as number,
		);
		const stalledWindow = createSchedulingWindow({
			requestAnimationFrame: stalledRequestFrame,
		});
		const activeWindow = createSchedulingWindow({
			requestAnimationFrame: activeRequestFrame,
			cancelAnimationFrame: (handle) => clearTimeout(handle),
		});
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const stalledController = new AbortController();
		const stalled = queue.enqueue(
			async () => "stalled",
			stalledController.signal,
			stalledWindow,
		);
		const stalledRejection = expect(stalled).rejects.toMatchObject({
			name: "AbortError",
		});

		const active = queue.enqueue(async () => "active", undefined, activeWindow);
		await vi.advanceTimersByTimeAsync(0);

		await expect(active).resolves.toBe("active");
		expect(stalledRequestFrame).toHaveBeenCalledOnce();
		expect(activeRequestFrame).toHaveBeenCalledOnce();

		stalledController.abort();
		await stalledRejection;
		queue.dispose();
	});

	test("runs through the watchdog when requestAnimationFrame stalls", async () => {
		let frameCallback: FrameRequestCallback | undefined;
		const requestFrame = vi.fn((callback: FrameRequestCallback) => {
			frameCallback = callback;
			return 25;
		});
		const ownerWindow = createSchedulingWindow({
			requestAnimationFrame: requestFrame,
		});
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const run = vi.fn(async () => "watchdog");
		const result = queue.enqueue(run, undefined, ownerWindow);

		await vi.advanceTimersByTimeAsync(99);
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		await expect(result).resolves.toBe("watchdog");
		frameCallback?.(100);
		await Promise.resolve();
		expect(run).toHaveBeenCalledOnce();
		queue.dispose();
	});

	test("starts up to four serialized tasks in one animation frame", async () => {
		const frameCallbacks: FrameRequestCallback[] = [];
		const requestFrame = vi.fn((callback: FrameRequestCallback) => {
			frameCallbacks.push(callback);
			return frameCallbacks.length;
		});
		const ownerWindow = createSchedulingWindow({
			requestAnimationFrame: requestFrame,
		});
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const events: number[] = [];
		const results = Array.from({ length: 4 }, (_, index) =>
			queue.enqueue(
				async () => {
					events.push(index);
					return index;
				},
				undefined,
				ownerWindow,
			),
		);

		expect(frameCallbacks).toHaveLength(1);
		frameCallbacks[0]?.(0);

		await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3]);
		expect(events).toEqual([0, 1, 2, 3]);
		expect(requestFrame).toHaveBeenCalledOnce();
		queue.dispose();
	});

	test("dispose rejects queued work and prevents new work", async () => {
		const ownerWindow = createSchedulingWindow({
			requestAnimationFrame: vi.fn(() => 77),
		});
		const { createPreviewRenderQueue } = await loadQueueModule();
		const queue = createPreviewRenderQueue();
		const queued = queue.enqueue(async () => "queued", undefined, ownerWindow);
		const queuedRejection = expect(queued).rejects.toMatchObject({
			name: "AbortError",
		});

		queue.dispose();

		await queuedRejection;
		await expect(queue.enqueue(async () => "late")).rejects.toMatchObject({
			name: "AbortError",
		});
	});
});
