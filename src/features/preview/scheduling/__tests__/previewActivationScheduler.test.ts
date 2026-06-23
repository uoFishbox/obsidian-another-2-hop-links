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
	canActivatePreviewImmediately,
	cancelPreviewActivation,
	createPreviewActivationScope,
	requestPreviewActivation,
	resetPreviewActivationSchedulerForTests,
	type PreviewActivationHandle,
	type PreviewActivationScope,
} from "../previewActivationScheduler";

const scrollSource = {};
let visibleQueueSize = 0;
const getVisibleQueueSize = () => visibleQueueSize;

function requestActivationResult(
	key: string,
	getQueueSize: () => number = getVisibleQueueSize,
	scope?: PreviewActivationScope,
): { handle: PreviewActivationHandle; result: Promise<boolean> } {
	let handle!: PreviewActivationHandle;
	const result = new Promise<boolean>((resolve) => {
		handle = requestPreviewActivation(key, getQueueSize, scope, resolve);
	});
	return { handle, result };
}

async function flushAnimationFrame(): Promise<void> {
	await vi.advanceTimersByTimeAsync(16);
	await Promise.resolve();
}

beforeEach(() => {
	state.disableCardDomPreview = false;
	visibleQueueSize = 0;
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) =>
			setTimeout(() => callback(Date.now()), 16),
		),
	);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
		clearTimeout(handle);
	});
});

afterEach(() => {
	resetPreviewActivationSchedulerForTests();
	resetScrollActivityForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("preview activation scheduler", () => {
	it("skips scheduled activation while card DOM previews are disabled", async () => {
		state.disableCardDomPreview = true;
		const getDisabledVisibleQueueSize = vi.fn(() => 1);

		expect(canActivatePreviewImmediately(getDisabledVisibleQueueSize)).toBe(
			false,
		);

		const onSettled = vi.fn();
		const activation = requestPreviewActivation(
			"preview-disabled",
			getDisabledVisibleQueueSize,
			undefined,
			onSettled,
		);

		expect(onSettled).toHaveBeenCalledWith(false);
		expect(getDisabledVisibleQueueSize).not.toHaveBeenCalled();
		expect(requestAnimationFrame).not.toHaveBeenCalled();
		expect(activation.key).toBe("preview-disabled");
	});

	it("queues the first idle request during the warmup window", async () => {
		const results: boolean[] = [];

		requestPreviewActivation(
			"preview-warmup",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);

		// The warmup window forces the initial batch through the queued drain
		// path so the first materialization batch does not render every
		// visible preview synchronously.
		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("activates immediately while scrolling is idle after warmup", async () => {
		// Drain the warmup window first.
		const warmup = requestActivationResult(
			"preview-warmup-drain",
			getVisibleQueueSize,
		);
		await flushAnimationFrame();
		await flushAnimationFrame();
		await expect(warmup.result).resolves.toBe(true);

		const activated: boolean[] = [];
		requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
			undefined,
			(value) => activated.push(value),
		);
		expect(activated).toEqual([true]);
	});

	it("limits scrolling activations to two previews per animation frame", async () => {
		markScrollActivityActive(scrollSource);

		const results: boolean[] = [];

		requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);
		requestPreviewActivation(
			"preview-b",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);
		requestPreviewActivation(
			"preview-c",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);

		await flushAnimationFrame();
		expect(results).toEqual([true, true]);

		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
	});

	it("limits idle activations to two previews per animation frame", async () => {
		visibleQueueSize = 1;

		const results: boolean[] = [];

		requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);
		requestPreviewActivation(
			"preview-b",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);
		requestPreviewActivation(
			"preview-c",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);

		visibleQueueSize = 0;

		await flushAnimationFrame();
		expect(results).toEqual([true, true]);

		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
	});

	it("delays activation while PreviewService has visible backlog", async () => {
		visibleQueueSize = 1;
		const results: boolean[] = [];

		const activation = requestActivationResult(
			"preview-a",
			getVisibleQueueSize,
		);
		activation.result.then((activated) => results.push(activated));

		await flushAnimationFrame();
		expect(results).toEqual([]);

		visibleQueueSize = 0;

		await flushAnimationFrame();
		await expect(activation.result).resolves.toBe(true);
		expect(results).toEqual([true]);
	});

	it("resolves replaced requests as not activated", async () => {
		markScrollActivityActive(scrollSource);

		const original = requestActivationResult(
			"preview-a",
			getVisibleQueueSize,
		);
		const replacement = requestActivationResult(
			"preview-a",
			getVisibleQueueSize,
		);

		await expect(original.result).resolves.toBe(false);

		await flushAnimationFrame();
		await expect(replacement.result).resolves.toBe(true);
	});

	it("resolves cancelled requests as not activated", async () => {
		markScrollActivityActive(scrollSource);

		const activation = requestActivationResult(
			"preview-a",
			getVisibleQueueSize,
		);
		cancelPreviewActivation("preview-a");

		await expect(activation.result).resolves.toBe(false);
	});

	it("handle cancel resolves only its own request as not activated", async () => {
		markScrollActivityActive(scrollSource);

		const activation = requestActivationResult(
			"preview-a",
			getVisibleQueueSize,
		);
		activation.handle.cancel();

		await expect(activation.result).resolves.toBe(false);
	});

	it("stale handle cancel does not affect new queued request with same key", async () => {
		markScrollActivityActive(scrollSource);

		const first = requestActivationResult("preview-a");
		const second = requestActivationResult("preview-a");

		first.handle.cancel();

		await expect(first.result).resolves.toBe(false);

		await flushAnimationFrame();
		await expect(second.result).resolves.toBe(true);
	});

	it("shares the cancel function across queued and settled handles", async () => {
		markScrollActivityActive(scrollSource);
		const queued = requestPreviewActivation(
			"preview-queued",
			getVisibleQueueSize,
		);

		markScrollActivityIdle(scrollSource);
		await flushAnimationFrame();
		await flushAnimationFrame();
		const settled = requestPreviewActivation(
			"preview-settled",
			getVisibleQueueSize,
		);

		expect(queued.cancel).toBe(settled.cancel);
	});

	it("invokes immediate settlement callbacks synchronously", async () => {
		const warmup = requestActivationResult("preview-warmup");
		await flushAnimationFrame();
		await flushAnimationFrame();
		await warmup.result;
		const results: boolean[] = [];

		requestPreviewActivation(
			"preview-immediate",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);

		expect(results).toEqual([true]);
	});

	it("continues draining when a settlement callback throws", async () => {
		markScrollActivityActive(scrollSource);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const results: boolean[] = [];

		requestPreviewActivation(
			"preview-throws",
			getVisibleQueueSize,
			undefined,
			() => {
				throw new Error("callback failed");
			},
		);
		requestPreviewActivation(
			"preview-after-throw",
			getVisibleQueueSize,
			undefined,
			(activated) => results.push(activated),
		);

		await flushAnimationFrame();

		expect(results).toEqual([true]);
		expect(consoleError).toHaveBeenCalledOnce();
	});

	it("applies warmup independently for each activation scope", async () => {
		const firstScope = createPreviewActivationScope();
		const secondScope = createPreviewActivationScope();

		const firstWarmup = requestActivationResult(
			"preview-a",
			getVisibleQueueSize,
			firstScope,
		);
		await flushAnimationFrame();
		await flushAnimationFrame();
		await expect(firstWarmup.result).resolves.toBe(true);

		expect(
			canActivatePreviewImmediately(getVisibleQueueSize, firstScope),
		).toBe(true);
		expect(
			canActivatePreviewImmediately(getVisibleQueueSize, secondScope),
		).toBe(false);
	});
});
