import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MathRenderTask } from "../renderers/mathRenderQueue";

const state = vi.hoisted(() => ({
	finishRenderMath: vi.fn<() => Promise<void>>(),
}));

vi.mock("obsidian", () => ({
	finishRenderMath: state.finishRenderMath,
}));

let originalRequestIdleCallback: Window["requestIdleCallback"] | undefined;

async function loadQueueModule() {
	return import("../renderers/mathRenderQueue");
}

function createTask(
	render: MathRenderTask["render"],
	commit: MathRenderTask["commit"] = async () => {},
): MathRenderTask {
	return { render, commit };
}

beforeEach(() => {
	vi.resetModules();
	state.finishRenderMath.mockReset();
	state.finishRenderMath.mockResolvedValue();
	originalRequestIdleCallback = window.requestIdleCallback;
});

afterEach(() => {
	window.requestIdleCallback = originalRequestIdleCallback!;
	vi.useRealTimers();
});

describe("enqueueMathRender", () => {
	test("executes via timeout fallback when requestIdleCallback is not called", async () => {
		vi.useFakeTimers();
		window.requestIdleCallback = vi.fn(() => 1);

		const { enqueueMathRender } = await loadQueueModule();
		const render = vi.fn(async () => true);
		const commit = vi.fn(async () => {});
		const taskPromise = enqueueMathRender(createTask(render, commit));

		expect(render).not.toHaveBeenCalled();
		await vi.runOnlyPendingTimersAsync();
		await taskPromise;

		expect(render).toHaveBeenCalledOnce();
		expect(state.finishRenderMath).toHaveBeenCalledOnce();
		expect(commit).toHaveBeenCalledOnce();
	});

	test("renders a batch, finalizes math once, then commits the batch", async () => {
		vi.useFakeTimers();
		const events: string[] = [];
		state.finishRenderMath.mockImplementation(async () => {
			events.push("finish");
		});
		const { enqueueMathRender } = await loadQueueModule();
		const createNamedTask = (name: string) =>
			createTask(
				async () => {
					events.push(`${name}:render`);
					return true;
				},
				async () => {
					events.push(`${name}:commit`);
				},
			);

		const promises = [
			enqueueMathRender(createNamedTask("first")),
			enqueueMathRender(createNamedTask("second")),
			enqueueMathRender(createNamedTask("third")),
		];
		await vi.advanceTimersByTimeAsync(0);
		await Promise.all(promises);

		expect(events).toEqual([
			"first:render",
			"second:render",
			"third:render",
			"finish",
			"first:commit",
			"second:commit",
			"third:commit",
		]);
		expect(state.finishRenderMath).toHaveBeenCalledOnce();
	});

	test("does not finalize math when no task submitted math", async () => {
		vi.useFakeTimers();
		const { enqueueMathRender } = await loadQueueModule();
		const commit = vi.fn(async () => {});
		const taskPromise = enqueueMathRender(createTask(async () => false, commit));

		await vi.advanceTimersByTimeAsync(0);
		await taskPromise;

		expect(state.finishRenderMath).not.toHaveBeenCalled();
		expect(commit).toHaveBeenCalledOnce();
	});

	test("does not commit rendered tasks when math finalization fails", async () => {
		vi.useFakeTimers();
		const finalizationError = new Error("math finalization failed");
		state.finishRenderMath.mockRejectedValue(finalizationError);
		const { enqueueMathRender } = await loadQueueModule();
		const firstCommit = vi.fn(async () => {});
		const secondCommit = vi.fn(async () => {});
		const promises = [
			enqueueMathRender(createTask(async () => true, firstCommit)),
			enqueueMathRender(createTask(async () => true, secondCommit)),
		];
		const resultsPromise = Promise.allSettled(promises);

		await vi.advanceTimersByTimeAsync(0);

		const results = await resultsPromise;
		expect(results).toEqual([
			{ status: "rejected", reason: finalizationError },
			{ status: "rejected", reason: finalizationError },
		]);
		expect(firstCommit).not.toHaveBeenCalled();
		expect(secondCommit).not.toHaveBeenCalled();
	});

	test("pending tasks with the same key are replaced by the latest", async () => {
		vi.useFakeTimers();
		const { enqueueMathRender } = await loadQueueModule();
		const events: string[] = [];
		let releaseBlockingTask!: () => void;
		const blockingPromise = new Promise<void>((resolve) => {
			releaseBlockingTask = resolve;
		});

		const firstTask = enqueueMathRender(
			createTask(async () => {
				events.push("first:start");
				await blockingPromise;
				events.push("first:end");
				return true;
			}),
		);
		await vi.advanceTimersByTimeAsync(0);

		const replacedTask = enqueueMathRender(
			createTask(async () => {
				events.push("replaced");
				return true;
			}),
			{ key: "card-key" },
		);
		const latestTask = enqueueMathRender(
			createTask(async () => {
				events.push("latest");
				return true;
			}),
			{ key: "card-key" },
		);

		releaseBlockingTask();
		await firstTask;
		await vi.advanceTimersByTimeAsync(0);
		await Promise.all([replacedTask, latestTask]);

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

		const firstTask = enqueueMathRender(
			createTask(async () => {
				events.push("first:start");
				await blockingPromise;
				events.push("first:end");
				return true;
			}),
		);
		await vi.advanceTimersByTimeAsync(0);

		const controller = new AbortController();
		const abortedTask = enqueueMathRender(
			createTask(async () => {
				events.push("aborted");
				return true;
			}),
			{ signal: controller.signal },
		);
		controller.abort();
		releaseBlockingTask();

		await Promise.all([firstTask, abortedTask]);
		expect(events).toEqual(["first:start", "first:end"]);
	});

	test("scheduled tasks are resolved by clear and not executed", async () => {
		vi.useFakeTimers();
		let idleCallback: IdleRequestCallback | undefined;
		window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
			idleCallback = callback;
			return 1;
		}) as Window["requestIdleCallback"];

		const { clearMathRenderQueue, enqueueMathRender } = await loadQueueModule();
		const render = vi.fn(async () => true);
		const taskPromise = enqueueMathRender(createTask(render));
		clearMathRenderQueue();
		await taskPromise;

		expect(render).not.toHaveBeenCalled();
		idleCallback?.({ didTimeout: false, timeRemaining: () => 50 });
		await vi.runOnlyPendingTimersAsync();
		expect(render).not.toHaveBeenCalled();
	});
});
