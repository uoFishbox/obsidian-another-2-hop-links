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
} from "ui/virtualization/scheduling/scrollActivity";
import {
	markVirtualScrollMeasurementRun,
	resetVirtualScrollMeasurementFrameForTests,
} from "ui/virtualization/scheduling/virtualScrollMeasurementFrame";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";
import {
	createPreviewActivationScope,
	disposePreviewActivationScheduler,
	requestQueuedPreviewActivation,
	resetPreviewActivationSchedulerForTests,
	type PreviewActivationHandle,
	type PreviewActivationScope,
} from "../previewActivationScheduler";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";

const scrollSource = {};
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 60;
let frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS;
let frameTimestamp = 0;
let frameTimeOrigin = 0;
let visibleQueueSize = 0;
let activeVisiblePreviewCount = 0;
let activationScope: PreviewActivationScope;
let results: string[];

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
}): Promise<number> {
	resetPreviewActivationSchedulerForTests();
	resetScrollActivityForTests();
	frameIntervalMs = params.intervalMs;
	const scope = createPreviewActivationScope();
	let activated = 0;

	markScrollActivityActive(scrollSource);
	for (let index = 0; index < 200; index += 1) {
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
	visibleQueueSize = 0;
	activeVisiblePreviewCount = 0;
	results = [];
	resetCCLDevMeasurements();
	activationScope = createPreviewActivationScope({
		getBackpressure: () => ({
			queued: visibleQueueSize,
			active: activeVisiblePreviewCount,
		}),
	});
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
		for (let index = 0; index < 20; index += 1) {
			requestActivation(`preview-${index}`);
		}

		await vi.advanceTimersByTimeAsync(1_000);
		expect(results.length).toBeGreaterThanOrEqual(7);
		expect(results.length).toBeLessThanOrEqual(9);
		expect(
			vi.mocked(requestAnimationFrame).mock.calls.length,
		).toBeGreaterThanOrEqual(results.length);
		expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBeLessThanOrEqual(
			results.length + 1,
		);
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
			durationMs: 1000,
		});
		const activationsAt120Hz = await countScrollingActivations({
			intervalMs: 1000 / 120,
			durationMs: 1000,
		});

		expect(Math.abs(activationsAt60Hz - activationsAt120Hz)).toBeLessThanOrEqual(1);
		expect(activationsAt60Hz).toBeGreaterThanOrEqual(7);
		expect(activationsAt60Hz).toBeLessThanOrEqual(9);
		expect(activationsAt120Hz).toBeGreaterThanOrEqual(7);
		expect(activationsAt120Hz).toBeLessThanOrEqual(9);
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
		visibleQueueSize = 1;
		requestActivation("preview-a");
		requestActivation("preview-b");
		requestActivation("preview-c");

		await flushAnimationFrame();
		expect(results).toEqual(["preview-a"]);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b"]);
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b", "preview-c"]);

		visibleQueueSize = 0;
		await flushAnimationFrame();
		expect(results).toEqual(["preview-a", "preview-b", "preview-c"]);
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
		const activation = requestActivation("preview-blocked", scope);
		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();

		queuedPreviewJobs = 1;
		await flushAnimationFrame();
		expect(activation.onActivated).toHaveBeenCalledOnce();
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

	it("does not combine backpressure from independent preview services", async () => {
		const blockedScope = createPreviewActivationScope({
			schedulerIdentity: {},
			getBackpressure: () => ({ queued: 2, active: 1 }),
		});
		const availableScope = createPreviewActivationScope({
			schedulerIdentity: {},
			getBackpressure: () => ({ queued: 0, active: 0 }),
		});
		const blocked = requestActivation("preview-blocked", blockedScope);
		const available = requestActivation("preview-available", availableScope);

		await flushAnimationFrame();

		expect(blocked.onActivated).not.toHaveBeenCalled();
		expect(available.onActivated).toHaveBeenCalledOnce();
	});

	it("waits for a backpressure notification instead of polling every frame", async () => {
		let pressure = { queued: 2, active: 1 };
		let notifyPressureChanged: (() => void) | undefined;
		const unsubscribe = vi.fn();
		const scope = createPreviewActivationScope({
			schedulerIdentity: {},
			getBackpressure: () => pressure,
			subscribeBackpressure: (listener) => {
				notifyPressureChanged = () => listener(pressure);
				return unsubscribe;
			},
		});
		const activation = requestActivation("preview-event-driven", scope);

		await flushAnimationFrame();
		expect(activation.onActivated).not.toHaveBeenCalled();
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1_000);
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

		pressure = { queued: 1, active: 1 };
		notifyPressureChanged?.();
		await flushAnimationFrame();
		expect(activation.onActivated).toHaveBeenCalledOnce();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
