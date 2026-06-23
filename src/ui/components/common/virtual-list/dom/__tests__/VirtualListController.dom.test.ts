import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVirtualListController } from "../virtualListController";
import { createVirtualListMeasurementState } from "../virtualListMeasurementState";

function createReadyMeasurement() {
	const measurement = createVirtualListMeasurementState();
	measurement.sectionTop = 0;
	measurement.viewportHeight = 200;
	measurement.hasStableScrollMetrics = true;
	return measurement;
}

describe("createVirtualListController", () => {
	it("skips active-scroll range measurement when the row window is unchanged", () => {
		const measurement = createReadyMeasurement();
		const rowModel = {};
		const applyRangeMeasurement = vi.fn(() => ({
			kind: "stable" as const,
			range: { start: 1, end: 4 },
		}));
		const onStableScrollMeasurement = vi.fn();
		const resolveScrollWindowMeasurement = vi.fn(() => ({
			identity: rowModel,
			ranges: {
				mounted: { start: 1, end: 4 },
				previewVisible: { start: 2, end: 3 },
			},
		}));

		const controller = createVirtualListController({
			getRootEl: () => null,
			measurement,
			getLayout: () => ({ rowHeight: 40, gap: 8 }),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement: () => ({
				layout: { rowHeight: 40, gap: 8 },
				content: {},
				hasRenderableContent: true,
				hasStableLayout: true,
			}),
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement,
			resolveScrollWindowMeasurement,
			onStableScrollMeasurement,
			maxUnstableMeasurementRetries: 1,
		});

		const sharedScrollMetrics = {
			scrollTop: 120,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
		};
		controller.runScrollMeasurement(sharedScrollMetrics);
		controller.runScrollMeasurement({
			...sharedScrollMetrics,
			frameId: 2,
		});

		expect(resolveScrollWindowMeasurement).toHaveBeenCalledTimes(2);
		expect(applyRangeMeasurement).toHaveBeenCalledTimes(1);
		expect(onStableScrollMeasurement).toHaveBeenCalledTimes(2);
	});

	it("applies active-scroll range measurement again when the row window changes", () => {
		const measurement = createReadyMeasurement();
		const rowModel = {};
		const applyRangeMeasurement = vi.fn(() => ({
			kind: "stable" as const,
			range: { start: 1, end: 4 },
		}));
		const resolveScrollWindowMeasurement = vi
			.fn()
			.mockReturnValueOnce({
				identity: rowModel,
				ranges: {
					mounted: { start: 1, end: 4 },
					previewVisible: { start: 2, end: 3 },
				},
			})
			.mockReturnValueOnce({
				identity: rowModel,
				ranges: {
					mounted: { start: 2, end: 5 },
					previewVisible: { start: 3, end: 4 },
				},
			});

		const controller = createVirtualListController({
			getRootEl: () => null,
			measurement,
			getLayout: () => ({}),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement: () => ({
				layout: {},
				content: {},
				hasRenderableContent: true,
				hasStableLayout: true,
			}),
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement,
			resolveScrollWindowMeasurement,
			maxUnstableMeasurementRetries: 1,
		});

		controller.runScrollMeasurement({
			scrollTop: 120,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
		});
		controller.runScrollMeasurement({
			scrollTop: 160,
			viewportHeight: 200,
			frameId: 2,
			isScrollActive: true,
		});

		expect(applyRangeMeasurement).toHaveBeenCalledTimes(2);
	});

	it("syncs mounted-only active scroll preview range without applying range measurement", () => {
		const rootEl = document.createElement("div");
		rootEl.getBoundingClientRect = () =>
			({
				top: 0,
				left: 0,
				right: 320,
				bottom: 240,
				width: 320,
				height: 240,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}) as DOMRect;

		const measurement = createVirtualListMeasurementState();
		const rowModel = {};
		const applyRangeMeasurement = vi.fn(() => ({
			kind: "stable" as const,
			range: { start: 1, end: 4 },
		}));
		let mountedRange = { start: 1, end: 4 };
		const resolveMountedScrollWindowMeasurement = vi.fn(() => ({
			identity: rowModel,
			mounted: mountedRange,
		}));
		const resolveScrollWindowMeasurement = vi.fn((...args: unknown[]) => {
			const mounted = args[5] as typeof mountedRange | undefined;
			const resolvedMounted = mounted ?? mountedRange;
			return {
				identity: rowModel,
				ranges: {
					mounted: resolvedMounted,
					previewVisible: {
						start: resolvedMounted.start + 1,
						end: resolvedMounted.end - 1,
					},
				},
			};
		});
		const onActiveScrollPreviewRangeMeasurement = vi.fn();

		const controller = createVirtualListController({
			getRootEl: () => rootEl,
			measurement,
			getLayout: () => ({}),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement: () => ({
				layout: {},
				content: {},
				hasRenderableContent: true,
				hasStableLayout: true,
			}),
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement,
			resolveMountedScrollWindowMeasurement,
			resolveScrollWindowMeasurement,
			onActiveScrollPreviewRangeMeasurement,
			activeScrollWindowComparison: "mounted-only",
			maxUnstableMeasurementRetries: 1,
		});

		controller.updateFromLiveMeasurement({}, {});
		controller.runScrollMeasurement({
			scrollTop: 8,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
		});
		controller.runScrollMeasurement({
			scrollTop: 8,
			viewportHeight: 200,
			frameId: 2,
			isScrollActive: true,
		});
		mountedRange = { start: 2, end: 5 };
		controller.runScrollMeasurement({
			scrollTop: 120,
			viewportHeight: 200,
			frameId: 3,
			isScrollActive: true,
		});

		expect(resolveMountedScrollWindowMeasurement).toHaveBeenCalledTimes(4);
		expect(resolveScrollWindowMeasurement).toHaveBeenCalledTimes(3);
		expect(
			resolveScrollWindowMeasurement.mock.calls.map((call) => call[6]),
		).toEqual([false, false, true]);
		expect(onActiveScrollPreviewRangeMeasurement).toHaveBeenCalledTimes(1);
		expect(onActiveScrollPreviewRangeMeasurement).toHaveBeenCalledWith({
			mounted: { start: 1, end: 4 },
			previewVisible: { start: 2, end: 3 },
		});
		expect(applyRangeMeasurement).toHaveBeenCalledTimes(2);
	});

	it("skips mounted-only preview measurement inside the stable preview scroll band", () => {
		const rootEl = document.createElement("div");
		rootEl.getBoundingClientRect = () =>
			({
				top: 0,
				left: 0,
				right: 320,
				bottom: 240,
				width: 320,
				height: 240,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			}) as DOMRect;

		const measurement = createVirtualListMeasurementState();
		const rowModel = {};
		const mountedRange = { start: 1, end: 4 };
		const applyRangeMeasurement = vi.fn(() => ({
			kind: "stable" as const,
			range: mountedRange,
		}));
		const resolveMountedScrollWindowMeasurement = vi.fn(() => ({
			identity: rowModel,
			mounted: mountedRange,
		}));
		const resolveScrollWindowMeasurement = vi.fn(() => ({
			identity: rowModel,
			ranges: {
				mounted: mountedRange,
				previewVisible: { start: 2, end: 3 },
			},
			stablePreviewScrollTopBand: { min: 0, max: 100 },
		}));

		const controller = createVirtualListController({
			getRootEl: () => rootEl,
			measurement,
			getLayout: () => ({}),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement: () => ({
				layout: {},
				content: {},
				hasRenderableContent: true,
				hasStableLayout: true,
			}),
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement,
			resolveMountedScrollWindowMeasurement,
			resolveScrollWindowMeasurement,
			activeScrollWindowComparison: "mounted-only",
			maxUnstableMeasurementRetries: 1,
		});

		controller.updateFromLiveMeasurement({}, {});
		controller.runScrollMeasurement({
			scrollTop: 8,
			viewportHeight: 200,
			frameId: 1,
			isScrollActive: true,
		});
		controller.runScrollMeasurement({
			scrollTop: 9,
			viewportHeight: 200,
			frameId: 2,
			isScrollActive: true,
		});

		expect(resolveMountedScrollWindowMeasurement).toHaveBeenCalledTimes(3);
		expect(resolveScrollWindowMeasurement).toHaveBeenCalledTimes(1);
		expect(applyRangeMeasurement).toHaveBeenCalledTimes(1);
	});
});

describe("createVirtualListController initial stabilization", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const createStableController = (rootEl: HTMLElement) => {
		const measurement = createVirtualListMeasurementState();
		measurement.sectionTop = 0;
		measurement.viewportHeight = 200;
		measurement.hasStableScrollMetrics = true;
		measurement.hasStableVisibleRange = true;

		const resolveLayoutMeasurement = vi.fn(() => ({
			layout: {},
			content: {},
			hasRenderableContent: true,
			hasStableLayout: true,
		}));
		const applyRangeMeasurement = vi.fn(() => ({
			kind: "stable" as const,
			range: { start: 0, end: 5 },
		}));

		const controller = createVirtualListController({
			getRootEl: () => rootEl,
			measurement,
			getLayout: () => ({}),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement,
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement,
			maxUnstableMeasurementRetries: 2,
		});

		return {
			controller,
			measurement,
			resolveLayoutMeasurement,
			applyRangeMeasurement,
		};
	};

	it("schedules post-paint stabilization after observeRoot", () => {
		const rootEl = document.createElement("div");
		const { controller, resolveLayoutMeasurement } = createStableController(rootEl);
		const runWithoutTracking = vi.fn((cb) => cb());

		const cleanup = controller.observeRoot(rootEl, runWithoutTracking);

		expect(runWithoutTracking).toHaveBeenCalledTimes(1);
		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(1);

		cleanup();
	});

	it("completes stabilization when stable range is achieved", async () => {
		const rootEl = document.createElement("div");
		const { controller, resolveLayoutMeasurement, measurement } =
			createStableController(rootEl);
		const runWithoutTracking = vi.fn((cb) => cb());

		controller.observeRoot(rootEl, runWithoutTracking);

		await vi.runAllTimersAsync();

		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(3);
		expect(measurement.hasStableVisibleRange).toBe(true);
	});

	it("does not schedule additional passes when already completed", async () => {
		const rootEl = document.createElement("div");
		const { controller, resolveLayoutMeasurement } = createStableController(rootEl);
		const runWithoutTracking = vi.fn((cb) => cb());

		const cleanup = controller.observeRoot(rootEl, runWithoutTracking);

		await vi.runAllTimersAsync();

		const callCountAfterStabilization = resolveLayoutMeasurement.mock.calls.length;

		await vi.runAllTimersAsync();

		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(
			callCountAfterStabilization,
		);

		cleanup();
	});

	it("cancels stabilization on cleanup before post-paint pass", async () => {
		const rootEl = document.createElement("div");
		const { controller, resolveLayoutMeasurement } = createStableController(rootEl);
		const runWithoutTracking = vi.fn((cb) => cb());

		const cleanup = controller.observeRoot(rootEl, runWithoutTracking);

		cleanup();

		await vi.runAllTimersAsync();

		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(1);
	});

	it("retries up to max passes when unstable", async () => {
		const rootEl = document.createElement("div");
		const measurement = createVirtualListMeasurementState();
		measurement.sectionTop = 0;
		measurement.viewportHeight = 200;
		measurement.hasStableScrollMetrics = false;
		measurement.hasStableVisibleRange = false;

		const resolveLayoutMeasurement = vi.fn(() => ({
			layout: {},
			content: {},
			hasRenderableContent: true,
			hasStableLayout: false,
		}));
		const applyRangeMeasurement = vi.fn(() => ({
			kind: "bootstrapped" as const,
			range: { start: 0, end: 0 },
		}));

		const controller = createVirtualListController({
			getRootEl: () => rootEl,
			measurement,
			getLayout: () => ({}),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement,
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement,
			maxUnstableMeasurementRetries: 2,
		});

		const runWithoutTracking = vi.fn((cb) => cb());

		controller.observeRoot(rootEl, runWithoutTracking);

		await vi.runAllTimersAsync();

		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(5);
		expect(measurement.hasStableVisibleRange).toBe(false);
	});

	it("reads live layout immediately when scrolling starts before metrics stabilize", () => {
		const scrollContainer = document.createElement("div");
		const rootEl = document.createElement("div");
		scrollContainer.style.overflow = "auto";
		scrollContainer.append(rootEl);
		document.body.append(scrollContainer);
		Object.defineProperty(scrollContainer, "scrollHeight", {
			configurable: true,
			value: 400,
		});
		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			value: 0,
		});

		let rootRect = {
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		} as DOMRect;
		rootEl.getBoundingClientRect = () => rootRect;
		scrollContainer.getBoundingClientRect = () => rootRect;

		const measurement = createVirtualListMeasurementState();
		const resolveLayoutMeasurement = vi.fn(() => ({
			layout: {},
			content: {},
			hasRenderableContent: true,
			hasStableLayout: true,
		}));
		const controller = createVirtualListController({
			getRootEl: () => rootEl,
			measurement,
			getLayout: () => ({}),
			setLayout: vi.fn(),
			isSameLayout: () => true,
			resolveLayoutMeasurement,
			getCachedContent: () => ({}),
			hasRenderableContent: () => true,
			applyRangeMeasurement: vi.fn(() => ({
				kind: "stable" as const,
				range: { start: 0, end: 5 },
			})),
			maxUnstableMeasurementRetries: 1,
		});

		const cleanup = controller.observeRoot(rootEl, (callback) => callback());
		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(1);
		expect(measurement.hasStableScrollMetrics).toBe(false);

		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			value: 200,
		});
		rootRect = {
			...rootRect,
			right: 320,
			bottom: 600,
			width: 320,
			height: 600,
		};
		scrollContainer.dispatchEvent(new Event("scroll"));

		expect(resolveLayoutMeasurement).toHaveBeenCalledTimes(2);
		expect(measurement.hasStableScrollMetrics).toBe(true);

		cleanup();
		scrollContainer.remove();
	});
});
