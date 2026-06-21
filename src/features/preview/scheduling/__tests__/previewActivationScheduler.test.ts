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
	resetScrollActivityForTests,
} from "infrastructure/scroll/scrollActivity";
import {
	canActivatePreviewImmediately,
	cancelPreviewActivation,
	createPreviewActivationScope,
	requestPreviewActivation,
	resetPreviewActivationSchedulerForTests,
} from "../previewActivationScheduler";

const scrollSource = {};
let visibleQueueSize = 0;
const getVisibleQueueSize = () => visibleQueueSize;

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

		const activation = requestPreviewActivation(
			"preview-disabled",
			getDisabledVisibleQueueSize,
		);

		await expect(activation.promise).resolves.toBe(false);
		expect(getDisabledVisibleQueueSize).not.toHaveBeenCalled();
		expect(requestAnimationFrame).not.toHaveBeenCalled();
	});

	it("queues the first idle request during the warmup window", async () => {
		const results: boolean[] = [];

		const first = requestPreviewActivation(
			"preview-warmup",
			getVisibleQueueSize,
		);
		first.promise.then((activated) => results.push(activated));

		// The warmup window forces the initial batch through the queued drain
		// path so the first materialization batch does not render every
		// visible preview synchronously.
		await flushAnimationFrame();
		expect(results).toEqual([true]);
	});

	it("activates immediately while scrolling is idle after warmup", async () => {
		// Drain the warmup window first.
		const warmup = requestPreviewActivation(
			"preview-warmup-drain",
			getVisibleQueueSize,
		);
		await flushAnimationFrame();
		await flushAnimationFrame();
		await expect(warmup.promise).resolves.toBe(true);

		await expect(
			requestPreviewActivation("preview-a", getVisibleQueueSize).promise,
		).resolves.toBe(true);
	});

	it("limits scrolling activations to two previews per animation frame", async () => {
		markScrollActivityActive(scrollSource);

		const first = requestPreviewActivation("preview-a", getVisibleQueueSize);
		const second = requestPreviewActivation("preview-b", getVisibleQueueSize);
		const third = requestPreviewActivation("preview-c", getVisibleQueueSize);
		const results: boolean[] = [];

		first.promise.then((activated) => results.push(activated));
		second.promise.then((activated) => results.push(activated));
		third.promise.then((activated) => results.push(activated));

		await flushAnimationFrame();
		expect(results).toEqual([true, true]);

		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
	});

	it("limits idle activations to two previews per animation frame", async () => {
		visibleQueueSize = 1;

		const first = requestPreviewActivation("preview-a", getVisibleQueueSize);
		const second = requestPreviewActivation("preview-b", getVisibleQueueSize);
		const third = requestPreviewActivation("preview-c", getVisibleQueueSize);
		const results: boolean[] = [];

		first.promise.then((activated) => results.push(activated));
		second.promise.then((activated) => results.push(activated));
		third.promise.then((activated) => results.push(activated));

		visibleQueueSize = 0;

		await flushAnimationFrame();
		expect(results).toEqual([true, true]);

		await flushAnimationFrame();
		expect(results).toEqual([true, true, true]);
	});

	it("delays activation while PreviewService has visible backlog", async () => {
		visibleQueueSize = 1;
		const results: boolean[] = [];

		const activation = requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
		);
		activation.promise.then((activated) => results.push(activated));

		await flushAnimationFrame();
		expect(results).toEqual([]);

		visibleQueueSize = 0;

		await flushAnimationFrame();
		await expect(activation.promise).resolves.toBe(true);
		expect(results).toEqual([true]);
	});

	it("resolves replaced requests as not activated", async () => {
		markScrollActivityActive(scrollSource);

		const original = requestPreviewActivation("preview-a", getVisibleQueueSize);
		const replacement = requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
		);

		await expect(original.promise).resolves.toBe(false);

		await flushAnimationFrame();
		await expect(replacement.promise).resolves.toBe(true);
	});

	it("resolves cancelled requests as not activated", async () => {
		markScrollActivityActive(scrollSource);

		const activation = requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
		);
		cancelPreviewActivation("preview-a");

		await expect(activation.promise).resolves.toBe(false);
	});

	it("handle cancel resolves only its own request as not activated", async () => {
		markScrollActivityActive(scrollSource);

		const activation = requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
		);
		activation.cancel();

		await expect(activation.promise).resolves.toBe(false);
	});

	it("stale handle cancel does not affect new queued request with same key", async () => {
		markScrollActivityActive(scrollSource);

		const first = requestPreviewActivation("preview-a", getVisibleQueueSize);
		const second = requestPreviewActivation("preview-a", getVisibleQueueSize);

		first.cancel();

		await expect(first.promise).resolves.toBe(false);

		await flushAnimationFrame();
		await expect(second.promise).resolves.toBe(true);
	});

	it("applies warmup independently for each activation scope", async () => {
		const firstScope = createPreviewActivationScope();
		const secondScope = createPreviewActivationScope();

		const firstWarmup = requestPreviewActivation(
			"preview-a",
			getVisibleQueueSize,
			firstScope,
		);
		await flushAnimationFrame();
		await flushAnimationFrame();
		await expect(firstWarmup.promise).resolves.toBe(true);

		expect(
			canActivatePreviewImmediately(getVisibleQueueSize, firstScope),
		).toBe(true);
		expect(
			canActivatePreviewImmediately(getVisibleQueueSize, secondScope),
		).toBe(false);
	});
});
