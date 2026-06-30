import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVirtualMeasurementController } from "../virtualMeasurementController";
import { createVirtualListMeasurementState } from "../virtualListMeasurementState";

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
		const controller = createVirtualMeasurementController({
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
		const controller = createVirtualMeasurementController({
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
		};
		const result = controller.runScrollMeasurement(sharedScrollMetrics);

		expect(result.kind).toBe("measured");
		expect(onMeasurement).toHaveBeenCalledWith({
			scrollTop: 120,
			viewportHeight: 200,
			sectionTop: 25,
			isStableMeasurement: true,
			isScrollActive: true,
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
		const controller = createVirtualMeasurementController({
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

	it("skips measurement when no root is available for layout", () => {
		const state = createVirtualListMeasurementState();
		const controller = createVirtualMeasurementController({
			getRootEl: () => null,
			measurement: state,
			maxUnstableMeasurementRetries: 1,
		});

		expect(controller.runLayoutMeasurement()).toEqual({
			kind: "skipped",
			reason: "no-root",
		});
	});

	it("can schedule post-paint initial stabilization without range callbacks", async () => {
		const rootEl = createRoot();
		document.body.append(rootEl);
		const state = createVirtualListMeasurementState();
		const onMeasurement = vi.fn();
		const controller = createVirtualMeasurementController({
			getRootEl: () => rootEl,
			measurement: state,
			onMeasurement,
			enableInitialStabilization: true,
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
});
