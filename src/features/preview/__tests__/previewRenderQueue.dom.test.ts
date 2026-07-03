import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let originalRequestIdleCallback: Window["requestIdleCallback"] | undefined;

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
	originalRequestIdleCallback = window.requestIdleCallback;
	window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
		setTimeout(
			() =>
				callback({
					didTimeout: false,
					timeRemaining: () => 50,
				}),
			0,
		);
		return 1;
	}) as Window["requestIdleCallback"];
});

afterEach(() => {
	window.requestIdleCallback = originalRequestIdleCallback!;
	vi.useRealTimers();
});

describe("enqueuePreviewRender", () => {
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

	test("reports active and pending render tasks as backlog", async () => {
		const { enqueuePreviewRender, getPreviewRenderBacklogCount } =
			await loadQueueModule();
		const releaseFirst = createDeferred();

		const first = enqueuePreviewRender(async () => {
			await releaseFirst.promise;
			return "first";
		});
		const second = enqueuePreviewRender(async () => "second");

		expect(getPreviewRenderBacklogCount()).toBe(2);

		await vi.advanceTimersByTimeAsync(0);
		expect(getPreviewRenderBacklogCount()).toBe(2);

		releaseFirst.resolve();
		await expect(first).resolves.toBe("first");

		await vi.advanceTimersByTimeAsync(0);
		await expect(second).resolves.toBe("second");
		expect(getPreviewRenderBacklogCount()).toBe(0);
	});
});
