import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createVirtualMeasurementController,
	type CreateVirtualMeasurementControllerOptions,
	type VirtualMeasurement,
} from "../virtualMeasurementController";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import { createVirtualListMeasurementState } from "../virtualListMeasurementState";

const createTestFrameCoordinator = (): VirtualFrameCoordinator => {
	const handles = new Map<string, number>();
	const taskKey = (lane: string, key: string): string => `${lane}:${key}`;
	return {
		schedule(lane, key, task): boolean {
			const resolvedKey = taskKey(lane, key);
			if (handles.has(resolvedKey)) return false;
			const handle = window.setTimeout(() => {
				handles.delete(resolvedKey);
				task();
			}, 0);
			handles.set(resolvedKey, handle);
			return true;
		},
		cancel(lane, key): void {
			const resolvedKey = taskKey(lane, key);
			const handle = handles.get(resolvedKey);
			if (handle !== undefined) window.clearTimeout(handle);
			handles.delete(resolvedKey);
		},
		isScheduled: (lane, key) => handles.has(taskKey(lane, key)),
		dispose(): void {
			for (const handle of handles.values()) window.clearTimeout(handle);
			handles.clear();
		},
	};
};

const createController = (
	options: Omit<CreateVirtualMeasurementControllerOptions, "frameCoordinator">,
) =>
	createVirtualMeasurementController({
		...options,
		frameCoordinator: createTestFrameCoordinator(),
	});

const createRoot = (rectOverrides: Partial<DOMRect> = {}): HTMLElement => {
	const rootEl = document.createElement("div");
	rootEl.getBoundingClientRect = () =>
		({
			top: 10,
			left: 0,
			right: 320,
			bottom: 410,
			width: 320,
			height: 400,
			x: 0,
			y: 10,
			toJSON: () => ({}),
			...rectOverrides,
		}) as DOMRect;
	return rootEl;
};

describe("createVirtualMeasurementController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("publishes live layout measurements without range computation callbacks", () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const onMeasurement = vi.fn();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 1,
		});
		const scrollTop = window.scrollY || window.pageYOffset || 0;

		const result = controller.runLayoutMeasurement();

		expect(result.kind).toBe("measured");
		expect(result.kind === "measured" && result.measurement.sectionRect?.top).toBe(
			10,
		);
		expect(onMeasurement).toHaveBeenCalledTimes(1);
		expect(onMeasurement).toHaveBeenCalledWith(
			expect.objectContaining({
				scrollTop,
				viewportHeight: window.innerHeight,
				sectionTop: 10 + scrollTop,
				isStableMeasurement: true,
				isScrollActive: false,
				source: "layout",
			}),
		);
		expect(state.sectionTop).toBe(10 + scrollTop);
		expect(state.viewportHeight).toBe(window.innerHeight);
		expect(state.hasStableScrollMetrics).toBe(true);

		rootEl.remove();
	});

	it("publishes cached scroll measurements from shared scroll metrics", () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		state.sectionTop = 25;
		state.viewportHeight = 200;
		state.hasStableScrollMetrics = true;
		const onMeasurement = vi.fn();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 1,
		});

		const sharedScrollMetrics = {
			scrollTop: 120,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
			scrollGeneration: 1,
		};
		const result = controller.runScrollMeasurement(sharedScrollMetrics);

		expect(result.kind).toBe("measured");
		expect(onMeasurement).toHaveBeenCalledWith({
			scrollTop: 120,
			viewportHeight: 200,
			sectionTop: 25,
			isStableMeasurement: true,
			isScrollActive: true,
			scrollGeneration: 1,
			source: "scroll",
			sharedScrollMetrics,
		});

		rootEl.remove();
	});

	it("skips unchanged stable cached scroll measurements", () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		state.sectionTop = 25;
		state.viewportHeight = 200;
		state.hasStableScrollMetrics = true;
		const onMeasurement = vi.fn();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 1,
		});
		const sharedScrollMetrics = {
			scrollTop: 120,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
			scrollGeneration: 1,
		};

		expect(controller.runScrollMeasurement(sharedScrollMetrics).kind).toBe(
			"measured",
		);
		const skipped = controller.runScrollMeasurement({
			...sharedScrollMetrics,
			frameId: 2,
		});

		expect(skipped).toEqual({
			kind: "skipped",
			reason: "unchanged-scroll",
		});
		expect(onMeasurement).toHaveBeenCalledTimes(1);

		rootEl.remove();
	});

	it("can force publish unchanged stable cached scroll measurements", () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		state.sectionTop = 25;
		state.viewportHeight = 200;
		state.hasStableScrollMetrics = true;
		const onMeasurement = vi.fn();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 1,
		});
		const sharedScrollMetrics = {
			scrollTop: 120,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
			scrollGeneration: 1,
		};

		expect(controller.runScrollMeasurement(sharedScrollMetrics).kind).toBe(
			"measured",
		);
		const forced = controller.runScrollMeasurement(
			{
				...sharedScrollMetrics,
				frameId: 2,
			},
			{ forcePublish: true },
		);

		expect(forced.kind).toBe("measured");
		expect(onMeasurement).toHaveBeenCalledTimes(2);

		rootEl.remove();
	});

	it("skips measurement when no root is available for layout", () => {
		const state = createVirtualListMeasurementState();
		const controller = createController({
			getRootEl: () => null,
			measurement: state,
			maxUnstableMeasurementRetries: 1,
		});

		expect(controller.runLayoutMeasurement()).toEqual({
			kind: "skipped",
			reason: "no-root",
		});
	});

	it("suppresses scroll work while layout measurement is pending", async () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const onMeasurement = vi.fn(
			(_measurement: VirtualMeasurement) => "stable" as const,
		);
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 1,
		});

		controller.scheduleLayoutMeasurement();
		controller.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();

		expect(onMeasurement).toHaveBeenCalledTimes(1);
		expect(onMeasurement.mock.calls[0]?.[0].source).toBe("layout");

		controller.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();

		expect(onMeasurement).toHaveBeenCalledTimes(2);
		expect(onMeasurement.mock.calls[1]?.[0].source).toBe("scroll");
		rootEl.remove();
	});

	it("bounds unstable layout retries", async () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const onMeasurement = vi.fn(() => "unstable" as const);
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 2,
		});

		controller.runLayoutMeasurement();
		await vi.runAllTimersAsync();

		// One immediate measurement plus the configured two retries.
		expect(onMeasurement).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(250);
		expect(onMeasurement).toHaveBeenCalledTimes(3);
		rootEl.remove();
	});

	it("retains observer scroll work when layout temporarily supersedes it", async () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const observerTask = vi.fn();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			maxUnstableMeasurementRetries: 1,
		});

		controller.scheduleScrollMeasurement(observerTask);
		controller.scheduleLayoutMeasurement();
		await vi.runAllTimersAsync();

		expect(observerTask).not.toHaveBeenCalled();
		controller.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();

		expect(observerTask).toHaveBeenCalledOnce();
		rootEl.remove();
	});

	it("can schedule post-paint initial stabilization without range callbacks", async () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const onMeasurement = vi.fn();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			initialStabilizationMaxPasses: 1,
			maxUnstableMeasurementRetries: 1,
		});

		const cleanup = controller.observeRoot(rootEl, (callback) => callback());

		expect(onMeasurement).toHaveBeenCalledTimes(1);

		await vi.runAllTimersAsync();

		expect(onMeasurement).toHaveBeenCalledTimes(2);

		cleanup();
		rootEl.remove();
	});

	it("defers unstable scroll-start live measurement outside the event handler", () => {
		const rootEl = createRoot({ height: 0, bottom: 10 });
		document.body.append(rootEl);
		const rectGetter = vi.spyOn(rootEl, "getBoundingClientRect");
		const state = createVirtualListMeasurementState();
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			maxUnstableMeasurementRetries: 1,
		});

		const cleanup = controller.observeRoot(rootEl);
		state.hasStableScrollMetrics = false;
		rectGetter.mockClear();

		window.dispatchEvent(new Event("scroll"));

		expect(rectGetter).not.toHaveBeenCalled();

		cleanup();
		rootEl.remove();
	});

	it("does not schedule a trailing scroll measurement after an unchanged layout", async () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const onMeasurement = vi.fn(
			(_measurement: VirtualMeasurement) => "stable" as const,
		);
		const controller = createController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			maxUnstableMeasurementRetries: 1,
		});

		const cleanup = controller.observeRoot(rootEl);
		const layoutResult = controller.runLayoutMeasurement();
		expect(layoutResult.kind).toBe("measured");
		if (layoutResult.kind === "measured") {
			controller.scheduleScrollMeasurementAfterLayout(layoutResult.measurement);
		}

		await vi.runAllTimersAsync();

		expect(
			onMeasurement.mock.calls.filter(
				([measurement]) => measurement.source === "scroll",
			),
		).toHaveLength(0);

		cleanup();
		rootEl.remove();
	});
});
