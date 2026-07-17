import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	disableCardDomPreview: false,
}));

vi.mock("../../../../appConstants", () => ({
	get DEBUG_DISABLE_CARD_DOM_PREVIEW() {
		return state.disableCardDomPreview;
	},
}));

import {
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "infrastructure/scroll/scrollActivity";
import {
	markVirtualScrollMeasurementRun,
	resetVirtualScrollMeasurementFrameForTests,
} from "infrastructure/scroll/virtualScrollMeasurementFrame";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	canActivatePreviewImmediately,
	cancelPreviewActivation,
	createPreviewActivationScope,
	disposePreviewActivationScheduler,
	requestPreviewActivation,
	requestQueuedPreviewActivation,
	resetPreviewActivationSchedulerForTests,
	type PreviewActivationHandle,
	type PreviewActivationScope,
} from "../previewActivationScheduler";
import type { VirtualFrameCoordinator } from "ui/virtualization/frameCoordinator";

const scrollSource = {};
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
let frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
let frameTimestamp = 0;
let visibleQueueSize = 0;
let activeVisiblePreviewCount = 0;
let activationScope: PreviewActivationScope;

function requestActivationResult(
	key: string,
	scope: PreviewActivationScope = activationScope,
): { handle: PreviewActivationHandle; result: Promise<boolean> } {
	let handle!: PreviewActivationHandle;
	const result = new Promise<boolean>((resolve) => {
		handle = requestPreviewActivation(key, scope, resolve);
	});
	return { handle, result };
}

function requestQueuedActivationResult(
	key: string,
	scope: PreviewActivationScope = activationScope,
): { handle: PreviewActivationHandle; result: Promise<boolean> } {
	let handle!: PreviewActivationHandle;
	const result = new Promise<boolean>((resolve) => {
		handle = requestQueuedPreviewActivation(key, scope, resolve);
	});
	return { handle, result };
}

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(frameIntervalMs);
	await Promise.resolve();
}

async function countScrollingActivations(params: {
	readonly intervalMs: number;
	readonly durationMs: number;
}): Promise<number> {
	resetPreviewActivationSchedulerForTests();
	resetScrollActivityForTests();
	frameIntervalMs = params.intervalMs;
	const scope = createPreviewActivationScope();
	let activated = 0;

	markScrollActivityActive(scrollSource);
	for (let index = 0; index < 200; index += 1) {
		requestQueuedPreviewActivation(`preview-${index}`, scope, (value) => {
			if (value) activated += 1;
		});
	}

	await vi.advanceTimersByTimeAsync(params.durationMs);
	return activated;
}

beforeEach(() => {
	state.disableCardDomPreview = false;
	frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
	frameTimestamp = 0;
	visibleQueueSize = 0;
	activeVisiblePreviewCount = 0;
	resetCCLDevMeasurements();
	activationScope = createPreviewActivationScope({
		getBackpressure: () => ({
			queued: visibleQueueSize,
			active: activeVisiblePreviewCount,
		}),
	});
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => {
				frameTimestamp += frameIntervalMs;
				callback(frameTimestamp);
			}, frameIntervalMs),
		),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
		clearTimeout(handle);
	});
});

afterEach(() => {
	resetPreviewActivationSchedulerForTests();
	resetScrollActivityForTests();
	resetVirtualScrollMeasurementFrameForTests();
	resetCCLDevMeasurements();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("preview activation scheduler", () => {
	it("skips scheduled activation while card DOM previews are disabled", () => {
		state.disableCardDomPreview = true;
		const getDisabledVisibleQueueSize = vi.fn(() => 1);
		const disabledScope = createPreviewActivationScope({
			getBackpressure: () => ({
				queued: getDisabledVisibleQueueSize(),
				active: 0,
			}),
		});

		expect(canActivatePreviewImmediately(disabledScope)).toBe(false);

		const onSettled = vi.fn();
		const activation = requestPreviewActivation(
			"preview-disabled",
			disabledScope,
			onSettled,
		);

		expect(onSettled).toHaveBeenCalledWith(false);
		expect(getDisabledVisibleQueueSize).not.toHaveBeenCalled();
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		expect(activation.key).toBe("preview-disabled");
	});

	it("queues the first idle request during the time-based warmup window", async () => {
		const results: boolean[] = [];

		requestPreviewActivation("preview-warmup", activationScope, (activated) =>
			results.push(activated),
		);

		expect(results).toEqual([]);
		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("defers a pending activation when scroll measurement ran in its frame", async () => {
		const results: boolean[] = [];
		requestQueuedPreviewActivation(
			"preview-after-measurement",
			activationScope,
			(activated) => results.push(activated),
		);
		markVirtualScrollMeasurementRun();

		await flushAnimationFrame();
		expect(results).toEqual([]);

		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("holds activation and animation-frame work until scrolling becomes idle", async () => {
		const results: boolean[] = [];
		markScrollActivityActive(scrollSource);
		for (const key of ["preview-a", "preview-b", "preview-c"]) {
			requestQueuedPreviewActivation(key, activationScope, (activated) =>
				results.push(activated),
			);
		}

		await vi.advanceTimersByTimeAsync(1_000);
		expect(results).toEqual([]);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["preview.activationScheduler.animationFrame"].count).toBe(0);
		expect(counters["preview.activationDuringScroll"].count).toBe(0);

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(results).toEqual([true, true]);
		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
		counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["preview.activationScheduler.animationFrame"].count).toBe(2);
	});

	it("delegates idle activation drains to the surface frame coordinator", async () => {
		let idleTask: (() => void) | undefined;
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((_lane, _key, task) => {
				idleTask = task;
				return true;
			}),
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const scope = createPreviewActivationScope({ frameCoordinator });
		const activation = requestQueuedActivationResult("preview-coordinated", scope);

		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"idle",
			"preview:activation-drain",
			expect.any(Function),
		);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		idleTask?.();

		await expect(activation.result).resolves.toBe(true);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
	});

	it("does not activate synchronously in a scroll measurement frame", async () => {
		expect(canActivatePreviewImmediately(activationScope)).toBe(false);
		await vi.advanceTimersByTimeAsync(32);
		markVirtualScrollMeasurementRun();
		const results: boolean[] = [];

		requestPreviewActivation(
			"preview-after-immediate-measurement",
			activationScope,
			(activated) => results.push(activated),
		);

		expect(results).toEqual([]);
		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("ends warmup based on elapsed time rather than animation-frame count", async () => {
		const scope = createPreviewActivationScope();

		expect(canActivatePreviewImmediately(scope)).toBe(false);
		await vi.advanceTimersByTimeAsync(31);
		expect(canActivatePreviewImmediately(scope)).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(canActivatePreviewImmediately(scope)).toBe(true);
	});

	it("activates immediately while scrolling is idle after warmup", async () => {
		const warmup = requestActivationResult("preview-warmup-drain");
		await flushAnimationFrame();
		await flushAnimationFrame();
		await expect(warmup.result).resolves.toBe(true);

		const activated: boolean[] = [];
		requestPreviewActivation("preview-a", activationScope, (value) =>
			activated.push(value),
		);
		expect(activated).toEqual([true]);
	});

	it("does not activate immediately while a preview job is active", async () => {
		await vi.advanceTimersByTimeAsync(32);
		activeVisiblePreviewCount = 1;

		expect(canActivatePreviewImmediately(activationScope)).toBe(false);
	});

	it("suppresses scrolling activation independently of refresh rate", async () => {
		const activationsAt60Hz = await countScrollingActivations({
			intervalMs: 1000 / 60,
			durationMs: 1000,
		});
		const activationsAt120Hz = await countScrollingActivations({
			intervalMs: 1000 / 120,
			durationMs: 1000,
		});

		expect(activationsAt60Hz).toBe(0);
		expect(activationsAt120Hz).toBe(0);
	});

	it("resumes queued activation at 120 Hz only after scroll idle", async () => {
		frameIntervalMs = 1000 / 120;
		markScrollActivityActive(scrollSource);
		const results: boolean[] = [];

		for (const key of ["preview-a", "preview-b", "preview-c"]) {
			requestQueuedPreviewActivation(key, activationScope, (activated) =>
				results.push(activated),
			);
		}

		await flushAnimationFrame();
		expect(results).toEqual([]);
		await flushAnimationFrame();
		expect(results).toEqual([]);
		await flushAnimationFrame();
		expect(results).toEqual([]);

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(results).toEqual([true, true]);
		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
	});

	it("limits backpressured activations to a lower time-based rate", async () => {
		visibleQueueSize = 1;
		const results: boolean[] = [];

		for (const key of ["preview-a", "preview-b", "preview-c"]) {
			requestQueuedPreviewActivation(key, activationScope, (activated) =>
				results.push(activated),
			);
		}

		await flushAnimationFrame();
		expect(results).toEqual([true]);
		await flushAnimationFrame();
		expect(results).toEqual([true, true]);
		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);

		visibleQueueSize = 0;
		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
	});

	it("keeps activating slowly while PreviewService has visible backlog", async () => {
		visibleQueueSize = 1;
		const results: boolean[] = [];
		const activation = requestActivationResult("preview-a");
		activation.result.then((activated) => results.push(activated));

		await flushAnimationFrame();
		await expect(activation.result).resolves.toBe(true);
		expect(results).toEqual([true]);
	});

	it("holds activation while the outstanding preview admission limit is full", async () => {
		let queuedPreviewJobs = 2;
		let activePreviewJobs = 1;
		const scope = createPreviewActivationScope({
			getBackpressure: () => ({
				queued: queuedPreviewJobs,
				active: activePreviewJobs,
			}),
		});
		const results: boolean[] = [];

		requestQueuedPreviewActivation("preview-blocked", scope, (activated) =>
			results.push(activated),
		);
		await flushAnimationFrame();
		expect(results).toEqual([]);

		queuedPreviewJobs = 1;
		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("uses a timeout fallback when requestAnimationFrame is unavailable", async () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const results: boolean[] = [];

		requestQueuedPreviewActivation(
			"preview-fallback",
			activationScope,
			(activated) => results.push(activated),
		);
		await vi.advanceTimersByTimeAsync(frameIntervalMs);

		expect(results).toEqual([true]);
	});

	it("settles pending activations when the scheduler is disposed", async () => {
		markScrollActivityActive(scrollSource);
		const result = requestActivationResult("preview-disposed");

		disposePreviewActivationScheduler();

		await expect(result.result).resolves.toBe(false);
	});

	it("uses one global animation-frame callback for multiple scopes", () => {
		const firstScope = createPreviewActivationScope();
		const secondScope = createPreviewActivationScope();

		requestQueuedPreviewActivation("preview-a", firstScope);
		requestQueuedPreviewActivation("preview-b", secondScope);

		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
	});

	it("drains multiple scopes in round-robin order", async () => {
		const firstScope = createPreviewActivationScope();
		const secondScope = createPreviewActivationScope();
		const activated: string[] = [];

		requestQueuedPreviewActivation("a-1", firstScope, () => activated.push("a-1"));
		requestQueuedPreviewActivation("a-2", firstScope, () => activated.push("a-2"));
		requestQueuedPreviewActivation("b-1", secondScope, () => activated.push("b-1"));
		requestQueuedPreviewActivation("b-2", secondScope, () => activated.push("b-2"));

		await flushAnimationFrame();
		expect(activated).toEqual(["a-1", "b-1"]);
	});

	it("does not synchronously burst when scrolling becomes idle", async () => {
		markScrollActivityActive(scrollSource);
		const results: boolean[] = [];
		requestQueuedPreviewActivation("preview-a", activationScope, (activated) =>
			results.push(activated),
		);

		markScrollActivityIdle(scrollSource);
		expect(results).toEqual([]);
		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("resolves replaced requests as not activated", async () => {
		markScrollActivityActive(scrollSource);
		const original = requestActivationResult("preview-a");
		const replacement = requestActivationResult("preview-a");

		await expect(original.result).resolves.toBe(false);
		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		await expect(replacement.result).resolves.toBe(true);
	});

	it("resolves cancelled requests as not activated", async () => {
		markScrollActivityActive(scrollSource);
		const activation = requestActivationResult("preview-a");
		cancelPreviewActivation("preview-a", activationScope);

		await expect(activation.result).resolves.toBe(false);
	});

	it("clears a scope queue after its final request is cancelled", () => {
		markScrollActivityActive(scrollSource);
		requestQueuedPreviewActivation("preview-a", activationScope);

		expect(activationScope.pendingQueue).toHaveLength(1);
		cancelPreviewActivation("preview-a", activationScope);

		expect(activationScope.pendingQueue).toEqual([]);
		expect(activationScope.pendingQueueHead).toBe(0);
	});

	it("handle cancel resolves only its own request as not activated", async () => {
		markScrollActivityActive(scrollSource);
		const activation = requestActivationResult("preview-a");
		activation.handle.cancel();

		await expect(activation.result).resolves.toBe(false);
	});

	it("stale handle cancel does not affect new queued request with same key", async () => {
		markScrollActivityActive(scrollSource);
		const first = requestActivationResult("preview-a");
		const second = requestActivationResult("preview-a");

		first.handle.cancel();
		await expect(first.result).resolves.toBe(false);
		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		await expect(second.result).resolves.toBe(true);
	});

	it("shares the cancel function across queued and settled handles", async () => {
		markScrollActivityActive(scrollSource);
		const queued = requestPreviewActivation("preview-queued", activationScope);

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		await flushAnimationFrame();
		const settled = requestPreviewActivation("preview-settled", activationScope);

		expect(queued.cancel).toBe(settled.cancel);
	});

	it("invokes immediate settlement callbacks synchronously", async () => {
		const warmup = requestActivationResult("preview-warmup");
		await flushAnimationFrame();
		await flushAnimationFrame();
		await warmup.result;
		const results: boolean[] = [];

		requestPreviewActivation("preview-immediate", activationScope, (activated) =>
			results.push(activated),
		);

		expect(results).toEqual([true]);
	});

	it("continues draining when a settlement callback throws", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const results: boolean[] = [];

		requestQueuedPreviewActivation("preview-throws", activationScope, () => {
			throw new Error("callback failed");
		});
		requestQueuedPreviewActivation(
			"preview-after-throw",
			activationScope,
			(activated) => results.push(activated),
		);

		await flushAnimationFrame();
		expect(results).toEqual([true]);
		expect(consoleError).toHaveBeenCalledOnce();
	});

	it("applies warmup independently for each activation scope", async () => {
		const firstScope = createPreviewActivationScope();
		const secondScope = createPreviewActivationScope();

		expect(canActivatePreviewImmediately(firstScope)).toBe(false);
		await vi.advanceTimersByTimeAsync(32);

		expect(canActivatePreviewImmediately(firstScope)).toBe(true);
		expect(canActivatePreviewImmediately(secondScope)).toBe(false);
	});

	describe("requestQueuedPreviewActivation", () => {
		it("does not activate synchronously even after warmup", async () => {
			await vi.advanceTimersByTimeAsync(32);
			canActivatePreviewImmediately(activationScope);
			await vi.advanceTimersByTimeAsync(32);

			const results: boolean[] = [];
			requestQueuedPreviewActivation(
				"preview-queued-idle",
				activationScope,
				(activated) => results.push(activated),
			);

			expect(results).toEqual([]);
			await flushAnimationFrame();
			expect(results).toEqual([true]);
		});

		it("allows idle queued activations to use a small burst", async () => {
			const results: boolean[] = [];
			for (const key of ["preview-a", "preview-b", "preview-c"]) {
				requestQueuedPreviewActivation(key, activationScope, (activated) =>
					results.push(activated),
				);
			}

			expect(results).toEqual([]);
			await flushAnimationFrame();
			expect(results).toEqual([true, true]);
			await flushAnimationFrame();
			expect(results).toEqual([true, true, true]);
		});

		it("replaces requests with the same key", async () => {
			const original = requestQueuedActivationResult("preview-a");
			const replacement = requestQueuedActivationResult("preview-a");

			await expect(original.result).resolves.toBe(false);
			await flushAnimationFrame();
			await expect(replacement.result).resolves.toBe(true);
		});
	});
});
