import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	disableCardDomPreview: false,
}));

vi.mock("../../../../appConstants", () => ({
	DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND: 64,
	getDebugDisableCardDomPreview: () => state.disableCardDomPreview,
}));

import {
	markScrollActivityActive,
	markScrollActivityIdle,
	resetScrollActivityForTests,
} from "ui/shared/scroll/scrollActivity";
import {
	markVirtualScrollMeasurementRun,
	resetVirtualScrollMeasurementFrameForTests,
} from "ui/virtualization/public";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	createPreviewActivationScheduler,
	type CreatePreviewActivationSchedulerOptions,
	type CreatePreviewActivationScopeOptions,
	type PreviewActivationHandle,
	type PreviewActivationScope,
} from "../previewActivationScheduler";
import type { VirtualFrameCoordinator } from "ui/shared/scheduling/frameCoordinator";

const scrollSource = {};
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
let frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
let frameTimestamp = 0;
let frameTimeOrigin = 0;
let outstandingPreviewJobCount = 0;
let activationScope: PreviewActivationScope;
let results: string[];
let defaultTestScheduler = createPreviewActivationScheduler();

function createPreviewActivationScope(
	options: CreatePreviewActivationScopeOptions = {},
): PreviewActivationScope {
	return defaultTestScheduler.createScope(options);
}
function requestQueuedPreviewActivation(
	key: string,
	scope: PreviewActivationScope,
	onActivated?: () => void,
): PreviewActivationHandle {
	return defaultTestScheduler.request(key, scope, onActivated);
}

function disposePreviewActivationScheduler(): void {
	defaultTestScheduler.dispose();
}

function resetPreviewActivationSchedulerForTests(
	options?: CreatePreviewActivationSchedulerOptions,
): void {
	defaultTestScheduler.dispose();
	defaultTestScheduler = createPreviewActivationScheduler(options);
}

function requestActivation(
	key: string,
	scope: PreviewActivationScope = activationScope,
): { handle: PreviewActivationHandle; onActivated: ReturnType<typeof vi.fn> } {
	const onActivated = vi.fn(() => {
		results.push(key);
	});
	const handle = requestQueuedPreviewActivation(key, scope, onActivated);
	return { handle, onActivated };
}

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(frameIntervalMs);
	await vi.advanceTimersByTimeAsync(1);
	await Promise.resolve();
}

async function countScrollingActivations(params: {
	readonly intervalMs: number;
	readonly durationMs: number;
	readonly activationsPerSecond?: number;
}): Promise<number> {
	resetPreviewActivationSchedulerForTests();
	resetScrollActivityForTests();
	frameIntervalMs = params.intervalMs;
	const activationsPerSecond = params.activationsPerSecond;
	resetPreviewActivationSchedulerForTests({
		getActivationsPerSecond: activationsPerSecond
			? () => activationsPerSecond
			: undefined,
	});
	const scope = createPreviewActivationScope();
	let activated = 0;

	markScrollActivityActive(scrollSource);
	for (let index = 0; index < 1_000; index += 1) {
		requestQueuedPreviewActivation(`preview-${index}`, scope, () => {
			activated += 1;
		});
	}

	await vi.advanceTimersByTimeAsync(params.durationMs);
	return activated;
}

beforeEach(() => {
	state.disableCardDomPreview = false;
	frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
	frameTimestamp = 0;
	outstandingPreviewJobCount = 0;
	results = [];
	resetCCLDevMeasurements();
	defaultTestScheduler = createPreviewActivationScheduler({
		getOutstandingPreviewJobCount: () => outstandingPreviewJobCount,
	});
	activationScope = defaultTestScheduler.createScope();
	vi.useFakeTimers();
	frameTimeOrigin = Date.now();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => {
				frameTimestamp = Math.max(
					frameTimestamp + frameIntervalMs,
					Date.now() - frameTimeOrigin,
				);
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
	it("disposes only scopes owned by one scheduler instance", async () => {
		const first = createPreviewActivationScheduler();
		const second = createPreviewActivationScheduler();
		const firstScope = first.createScope();
		const secondScope = second.createScope();
		const firstActivated = vi.fn();
		const secondActivated = vi.fn();
		first.request("same-key", firstScope, firstActivated);
		second.request("same-key", secondScope, secondActivated);

		first.dispose();
		await flushAnimationFrame();
		expect(firstActivated).not.toHaveBeenCalled();
		expect(secondActivated).toHaveBeenCalledOnce();
		second.dispose();
	});
	it("never activates synchronously through the queued path", async () => {
		const activation = requestActivation("preview-queued");

		expect(activation.onActivated).not.toHaveBeenCalled();
		await flushAnimationFrame();
		expect(activation.onActivated).toHaveBeenCalledOnce();
	});

	it("defers a pending activation when scroll measurement ran in its frame", async () => {
		const activation = requestActivation("preview-after-measurement");
		markVirtualScrollMeasurementRun();
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();

		await flushAnimationFrame();
		expect(activation.onActivated).toHaveBeenCalledOnce();
	});

	it("activates previews sparsely while scrolling", async () => {
		markScrollActivityActive(scrollSource);
		for (let index = 0; index < 200; index += 1) {
			requestActivation(`preview-${index}`);
		}

		await vi.advanceTimersByTimeAsync(1_000);
		expect(results.length).toBeGreaterThanOrEqual(62);
		expect(results.length).toBeLessThanOrEqual(65);
		let counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["preview.activationScheduler.animationFrame"].count).toBe(
			vi.mocked(requestAnimationFrame).mock.calls.length,
		);
		expect(counters["preview.activationDuringScroll"].count).toBe(results.length);
		const scrollingActivationCount = results.length;
		const scrollingFrameCount = vi.mocked(requestAnimationFrame).mock.calls.length;

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(results.length).toBe(scrollingActivationCount + 2);
		expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBeGreaterThan(
			scrollingFrameCount,
		);
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
		const activation = requestActivation("preview-coordinated", scope);

		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"idle",
			expect.stringMatching(/^preview:activation-drain:/),
			expect.any(Function),
		);
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		idleTask?.();

		await Promise.resolve();
		expect(activation.onActivated).toHaveBeenCalledOnce();
		expect(requestAnimationFrame).not.toHaveBeenCalled();
	});

	it("delegates scrolling activation drains to the post-paint lane", async () => {
		markScrollActivityActive(scrollSource);
		let postPaintTask: (() => void) | undefined;
		const frameCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((_lane, _key, task) => {
				postPaintTask = task;
				return true;
			}),
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const scope = createPreviewActivationScope({ frameCoordinator });
		const activation = requestActivation("preview-coordinated-scroll", scope);

		expect(frameCoordinator.schedule).toHaveBeenCalledWith(
			"post-paint",
			expect.stringMatching(/^preview:activation-drain:/),
			expect.any(Function),
		);
		postPaintTask?.();

		await Promise.resolve();
		expect(activation.onActivated).toHaveBeenCalledOnce();
	});

	it("rate-limits scrolling activation independently of refresh rate", async () => {
		const activationsAt60Hz = await countScrollingActivations({
			intervalMs: 1000 / 60,
			durationMs: 5_000,
		});
		const activationsAt120Hz = await countScrollingActivations({
			intervalMs: 1000 / 120,
			durationMs: 5_000,
		});

		expect(Math.abs(activationsAt60Hz - activationsAt120Hz)).toBeLessThanOrEqual(2);
		expect(activationsAt60Hz).toBeGreaterThanOrEqual(317);
		expect(activationsAt60Hz).toBeLessThanOrEqual(321);
		expect(activationsAt120Hz).toBeGreaterThanOrEqual(317);
		expect(activationsAt120Hz).toBeLessThanOrEqual(321);
	});

	it("honors the configured activations-per-second limit", async () => {
		const activated = await countScrollingActivations({
			intervalMs: 1000 / 60,
			durationMs: 5_000,
			activationsPerSecond: 32,
		});

		expect(activated).toBeGreaterThanOrEqual(157);
		expect(activated).toBeLessThanOrEqual(161);
	});

	it("switches delayed scrolling work back to the idle burst policy", async () => {
		frameIntervalMs = 1000 / 120;
		markScrollActivityActive(scrollSource);
		requestActivation("preview-a");
		requestActivation("preview-b");
		requestActivation("preview-c");

		await flushAnimationFrame();
		expect(results).toEqual(["preview-a"]);

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b"]);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b", "preview-c"]);
	});

	it("clamps idle credit when scrolling starts", async () => {
		frameIntervalMs = 1_000;
		requestActivation("preview-idle");

		await flushAnimationFrame();
		expect(results).toEqual(["preview-idle"]);

		markScrollActivityActive(scrollSource);
		for (const key of ["preview-a", "preview-b", "preview-c", "preview-d"]) {
			requestActivation(key);
		}

		await flushAnimationFrame();
		expect(results).toEqual(["preview-idle", "preview-a"]);
	});

	it("limits idle activations to a small time-based burst", async () => {
		requestActivation("preview-a");
		requestActivation("preview-b");
		requestActivation("preview-c");

		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b"]);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b", "preview-c"]);
	});

	it("limits backpressured activations to a lower time-based rate", async () => {
		outstandingPreviewJobCount = 1;
		requestActivation("preview-a");
		requestActivation("preview-b");
		requestActivation("preview-c");

		await flushAnimationFrame();
		expect(results).toEqual(["preview-a"]);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b"]);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b", "preview-c"]);

		outstandingPreviewJobCount = 0;
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b", "preview-c"]);
	});

	it("holds activation while the outstanding preview admission limit is full", async () => {
		let outstandingPreviewJobCount = 3;
		resetPreviewActivationSchedulerForTests({
			getOutstandingPreviewJobCount: () => outstandingPreviewJobCount,
		});
		const scope = createPreviewActivationScope();
		const activation = requestActivation("preview-blocked", scope);
		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();

		outstandingPreviewJobCount = 2;
		await flushAnimationFrame();
		expect(activation.onActivated).toHaveBeenCalledOnce();
	});

	it("refreshes outstanding count only after an activation callback", async () => {
		let outstandingPreviewJobCount = 0;
		const getOutstandingPreviewJobCount = vi.fn(() => outstandingPreviewJobCount);
		resetPreviewActivationSchedulerForTests({
			getOutstandingPreviewJobCount,
			subscribeBackpressure: () => vi.fn(),
		});
		const scope = createPreviewActivationScope();
		const first = requestActivation("preview-first", scope);
		first.onActivated.mockImplementation(() => {
			outstandingPreviewJobCount = 3;
		});
		const second = requestActivation("preview-second", scope);

		await flushAnimationFrame();

		expect(first.onActivated).toHaveBeenCalledOnce();
		expect(second.onActivated).not.toHaveBeenCalled();
		expect(getOutstandingPreviewJobCount).toHaveBeenCalledTimes(2);
	});

	it("does not poll outstanding count for stale replacement entries", async () => {
		const getOutstandingPreviewJobCount = vi.fn(() => 0);
		resetPreviewActivationSchedulerForTests({ getOutstandingPreviewJobCount });
		const scope = createPreviewActivationScope();

		for (let index = 0; index < 100; index += 1) {
			requestActivation("same-key", scope);
		}

		await flushAnimationFrame();

		expect(results).toEqual(["same-key"]);
		expect(getOutstandingPreviewJobCount).toHaveBeenCalledTimes(2);
	});

	it("uses a timeout fallback when requestAnimationFrame is unavailable", async () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const activation = requestActivation("preview-fallback");

		await vi.advanceTimersByTimeAsync(frameIntervalMs);
		expect(activation.onActivated).toHaveBeenCalledOnce();
	});

	it("settles pending activations without invoking the callback when disposed", async () => {
		markScrollActivityActive(scrollSource);
		const activation = requestActivation("preview-disposed");

		disposePreviewActivationScheduler();

		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();
	});

	it("does not recreate scopes or queue work after disposal", async () => {
		const scheduler = createPreviewActivationScheduler();
		const existingScope = scheduler.createScope();
		const existingScopeCallback = vi.fn();
		scheduler.dispose();

		expect(() =>
			scheduler.request("existing", existingScope, existingScopeCallback),
		).not.toThrow();
		const disposedScope = scheduler.createScope();
		const disposedScopeCallback = vi.fn();
		const handle = scheduler.request(
			"disposed",
			disposedScope,
			disposedScopeCallback,
		);
		handle.cancel();
		await flushAnimationFrame();

		expect(existingScopeCallback).not.toHaveBeenCalled();
		expect(disposedScopeCallback).not.toHaveBeenCalled();
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

		requestActivation("a-1", firstScope);
		requestActivation("a-2", firstScope);
		requestActivation("b-1", secondScope);
		requestActivation("b-2", secondScope);

		await flushAnimationFrame();
		expect(results).toEqual(["a-1", "b-1"]);
	});

	it("coalesces requests sharing the same key", async () => {
		markScrollActivityActive(scrollSource);
		const original = requestActivation("preview-a");
		const replacement = requestActivation("preview-a");

		expect(original.onActivated).not.toHaveBeenCalled();
		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		expect(original.onActivated).not.toHaveBeenCalled();
		expect(replacement.onActivated).toHaveBeenCalledOnce();
	});

	it("does not activate a cancelled request", async () => {
		markScrollActivityActive(scrollSource);
		const activation = requestActivation("preview-a");
		activation.handle.cancel();

		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();
	});

	it("shares the cancel function across activation handles", () => {
		const first = requestActivation("preview-a");
		const second = requestActivation("preview-b");

		expect(first.handle.cancel).toBe(second.handle.cancel);
	});

	it("continues draining when a settlement callback throws", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const throwing = requestActivation("preview-throws");
		throwing.onActivated.mockImplementation(() => {
			throw new Error("callback failed");
		});
		const normal = requestActivation("preview-after-throw");

		await flushAnimationFrame();
		expect(normal.onActivated).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledOnce();
	});

	it("skips activation entirely while card DOM previews are disabled", async () => {
		state.disableCardDomPreview = true;
		const activation = requestActivation("preview-disabled");

		expect(activation.onActivated).not.toHaveBeenCalled();
		expect(requestAnimationFrame).not.toHaveBeenCalled();

		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();
	});

	it("keeps coordinator drains isolated to their own surface", async () => {
		let firstIdleTask: (() => void) | undefined;
		let secondIdleTask: (() => void) | undefined;
		const firstCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((_lane, _key, task) => {
				firstIdleTask = task;
				return true;
			}),
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const secondCoordinator: VirtualFrameCoordinator = {
			schedule: vi.fn((_lane, _key, task) => {
				secondIdleTask = task;
				return true;
			}),
			cancel: vi.fn(),
			isScheduled: vi.fn(() => false),
			dispose: vi.fn(),
		};
		const firstScope = createPreviewActivationScope({
			frameCoordinator: firstCoordinator,
		});
		const secondScope = createPreviewActivationScope({
			frameCoordinator: secondCoordinator,
		});
		const first = requestActivation("preview-first", firstScope);
		const second = requestActivation("preview-second", secondScope);

		expect(firstCoordinator.schedule).toHaveBeenCalledOnce();
		expect(secondCoordinator.schedule).toHaveBeenCalledOnce();
		firstIdleTask?.();
		await Promise.resolve();

		expect(first.onActivated).toHaveBeenCalledOnce();
		expect(second.onActivated).not.toHaveBeenCalled();

		secondIdleTask?.();
		await Promise.resolve();
		expect(second.onActivated).toHaveBeenCalledOnce();
	});

	it("blocks every scope while the shared backpressure is full", async () => {
		resetPreviewActivationSchedulerForTests({
			getOutstandingPreviewJobCount: () => 3,
		});
		const scope = createPreviewActivationScope();
		const blocked = requestActivation("preview-blocked", scope);

		await flushAnimationFrame();

		expect(blocked.onActivated).not.toHaveBeenCalled();
	});

	it("waits for a backpressure notification instead of polling every frame", async () => {
		let outstandingPreviewJobCount = 3;
		let notifyPressureChanged: (() => void) | undefined;
		const unsubscribe = vi.fn();
		resetPreviewActivationSchedulerForTests({
			getOutstandingPreviewJobCount: () => outstandingPreviewJobCount,
			subscribeBackpressure: (listener) => {
				notifyPressureChanged = listener;
				return unsubscribe;
			},
		});
		const scope = createPreviewActivationScope();
		const activation = requestActivation("preview-event-driven", scope);

		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		outstandingPreviewJobCount = 2;
		notifyPressureChanged?.();
		await flushAnimationFrame();
		expect(activation.onActivated).toHaveBeenCalledOnce();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
