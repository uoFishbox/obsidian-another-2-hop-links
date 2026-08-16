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

async function loadQueueModule() {
	const module = await import("../renderers/previewRenderQueue");
	return module;
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

describe("enqueuePreviewRender", () => {
	test("schedules preview rendering on the next animation frame", async () => {
		const requestIdleCallback = vi.spyOn(window, "requestIdleCallback");
		const { enqueuePreviewRender } = await loadQueueModule();
		const { getCCLDevMeasurementSnapshot } =
			await import("infrastructure/debug/CCLDevMeasurements");

		const result = enqueuePreviewRender(async () => "rendered");
		await vi.runAllTimersAsync();

		await expect(result).resolves.toBe("rendered");
		expect(requestIdleCallback).not.toHaveBeenCalled();
		expect(vi.mocked(requestAnimationFrame)).toHaveBeenCalledTimes(1);
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"preview.renderScheduler.animationFrame"
			].count,
		).toBe(1);
	});

	test("preview render tasks are serialized", async () => {
		const { enqueuePreviewRender } = await loadQueueModule();
		const releaseFirst = createDeferred();
		const events: string[] = [];

		const first = enqueuePreviewRender(async () => {
			events.push("first:start");
			await releaseFirst.promise;
			events.push("first:end");
			return "first";
		});
		const second = enqueuePreviewRender(async () => {
			events.push("second");
			return "second";
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(events).toEqual(["first:start"]);

		releaseFirst.resolve();
		await expect(first).resolves.toBe("first");

		await vi.advanceTimersByTimeAsync(0);
		await expect(second).resolves.toBe("second");
		expect(events).toEqual(["first:start", "first:end", "second"]);
	});

	test("aborted queued render tasks reject without running", async () => {
		const { enqueuePreviewRender } = await loadQueueModule();
		const releaseFirst = createDeferred();
		const controller = new AbortController();
		const events: string[] = [];

		const first = enqueuePreviewRender(async () => {
			events.push("first:start");
			await releaseFirst.promise;
			events.push("first:end");
		});
		const aborted = enqueuePreviewRender(async () => {
			events.push("aborted");
		}, controller.signal);

		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		releaseFirst.resolve();

		await first;
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		expect(events).toEqual(["first:start", "first:end"]);
	});

	test("aborted pending render tasks reject before active render finishes", async () => {
		const { enqueuePreviewRender } = await loadQueueModule();
		const releaseFirst = createDeferred();
		const controller = new AbortController();
		let abortedSettled = false;
		const events: string[] = [];

		const first = enqueuePreviewRender(async () => {
			events.push("first:start");
			await releaseFirst.promise;
			events.push("first:end");
		});
		const aborted = enqueuePreviewRender(async () => {
			events.push("aborted");
		}, controller.signal);
		aborted.catch(() => {
			abortedSettled = true;
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(events).toEqual(["first:start"]);

		controller.abort();
		await Promise.resolve();

		expect(abortedSettled).toBe(true);
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		expect(events).toEqual(["first:start"]);

		releaseFirst.resolve();
		await first;
		expect(events).toEqual(["first:start", "first:end"]);
	});
});
