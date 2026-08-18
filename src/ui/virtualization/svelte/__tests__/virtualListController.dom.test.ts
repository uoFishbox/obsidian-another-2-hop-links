import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StableScrollTopBand } from "../../core/scrollWindowMeasurement";
import type { VirtualVisibilityPolicy } from "../../core/virtualListEngine";
import type { ScrollMeasurementRange } from "../../dom/virtualListDomObserver";
import { createVirtualListMeasurementState } from "../../dom/virtualListMeasurementState";
import type { RowRange } from "../../rowRange";
import type { VirtualFrameCoordinator } from "../../scheduling/frameCoordinator";
import type { VirtualRanges } from "../../types";
import {
	createVirtualListController,
	type CreateVirtualListControllerOptions,
} from "../virtualListController";

const viewportObservationHarness = vi.hoisted(() => ({
	publishScrollMeasurementRange:
		vi.fn<(range: ScrollMeasurementRange | null) => void>(),
}));

vi.mock("../../dom/virtualListDomObserver", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../dom/virtualListDomObserver")>();
	return {
		...actual,
		observeVirtualListViewport: () =>
			Object.assign(
				vi.fn<() => void>(() => {}),
				{
					publishScrollMeasurementRange:
						viewportObservationHarness.publishScrollMeasurementRange,
				},
			) as ReturnType<typeof actual.observeVirtualListViewport>,
	};
});

const VISIBILITY_POLICY: VirtualVisibilityPolicy = {
	bootstrapRows: 1,
	mountedOverscanPx: 0,
	previewOverscanPx: 0,
};

interface TestRowModelState {
	rowCount?: number;
	totalHeight?: number;
	mounted: RowRange;
	previewVisible: RowRange;
	mountedCoverageBand?: StableScrollTopBand;
	previewCoverageBand?: StableScrollTopBand;
}

const copyRange = (out: RowRange, range: RowRange): void => {
	out.start = range.start;
	out.end = range.end;
};

const createTestRowModel = (state: TestRowModelState) => ({
	get rowCount() {
		return state.rowCount ?? 100;
	},
	get totalHeight() {
		return state.totalHeight ?? 1_000;
	},
	findVisibleRangeInto(out: RowRange) {
		copyRange(out, state.mounted);
	},
	findVisibleRangesInto(out: VirtualRanges) {
		copyRange(out.mounted, state.mounted);
		copyRange(out.previewVisible, state.previewVisible);
	},
	findVisibleRangesFromMountedInto(
		out: VirtualRanges,
		{ mounted }: { mounted: RowRange },
	) {
		copyRange(out.mounted, mounted);
		copyRange(out.previewVisible, state.previewVisible);
	},
	findMountedCoverageScrollTopBandInto(
		out: { min: number; max: number },
		{ mounted }: { mounted: RowRange },
	) {
		const isPreviewRange =
			mounted.start === state.previewVisible.start &&
			mounted.end === state.previewVisible.end;
		const band = isPreviewRange
			? state.previewCoverageBand
			: state.mountedCoverageBand;
		out.min = band?.min ?? Number.POSITIVE_INFINITY;
		out.max = band?.max ?? Number.NEGATIVE_INFINITY;
	},
});

type TestRowModel = ReturnType<typeof createTestRowModel>;

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

const createControllerHarness = (
	state: TestRowModelState = {
		mounted: { start: 0, end: 10 },
		previewVisible: { start: 2, end: 8 },
	},
	overrides: Partial<
		CreateVirtualListControllerOptions<TestRowModel, TestRowModel>
	> = {},
) => {
	const rootEl = createRoot();
	document.body.append(rootEl);
	const rowModel = createTestRowModel(state);
	const measurement = createVirtualListMeasurementState();
	measurement.sectionTop = 0;
	measurement.viewportHeight = 100;
	measurement.hasStableScrollMetrics = true;
	const applyRangeMeasurement = vi.fn<
		CreateVirtualListControllerOptions<
			TestRowModel,
			TestRowModel
		>["applyRangeMeasurement"]
	>(() => ({
		kind: "stable" as const,
		range: { start: 0, end: 0 },
	}));
	const options: CreateVirtualListControllerOptions<TestRowModel, TestRowModel> = {
		getRootEl: () => rootEl,
		measurement,
		getContext: () => rowModel,
		hasRenderableContent: () => true,
		resolveRowModel: (model) => model,
		resolveVisibilityPolicy: () => VISIBILITY_POLICY,
		applyRangeMeasurement,
		resolveLayoutMeasurement: (nextMeasurement) => ({
			context: rowModel,
			measurement: nextMeasurement,
			isStable: true,
		}),
		frameCoordinator: createTestFrameCoordinator(),
		...overrides,
	};
	const controller = createVirtualListController(options);
	return { controller, rootEl, rowModel, measurement, applyRangeMeasurement };
};

const ACTIVE_SCROLL_METRICS = {
	scrollTop: 50,
	viewportHeight: 100,
	frameId: 1,
	isScrollActive: true,
	scrollGeneration: 1,
};

describe("createVirtualListController", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		viewportObservationHarness.publishScrollMeasurementRange.mockReset();
	});

	afterEach(() => {
		document.body.replaceChildren();
		vi.useRealTimers();
	});

	it("applies live layout measurement and updates measurement state", () => {
		const { controller, measurement, applyRangeMeasurement } =
			createControllerHarness();
		const scrollTop = window.scrollY || window.pageYOffset || 0;

		const result = controller.runLayoutMeasurement();

		expect(result.kind).toBe("measured");
		expect(applyRangeMeasurement).toHaveBeenCalledWith(
			expect.objectContaining({
				scrollTop,
				viewportHeight: window.innerHeight,
				sectionTop: 10 + scrollTop,
				isStableMeasurement: true,
				isScrollActive: false,
				source: "layout",
			}),
			expect.anything(),
			undefined,
		);
		expect(measurement.sectionTop).toBe(10 + scrollTop);
		expect(measurement.viewportHeight).toBe(window.innerHeight);
		expect(measurement.hasStableScrollMetrics).toBe(true);
	});

	it("publishes cached scroll measurements and skips unchanged stable geometry", () => {
		const { controller, applyRangeMeasurement } = createControllerHarness();

		expect(controller.runScrollMeasurement(ACTIVE_SCROLL_METRICS).kind).toBe(
			"measured",
		);
		const skipped = controller.runScrollMeasurement({
			...ACTIVE_SCROLL_METRICS,
			frameId: 2,
		});

		expect(skipped).toEqual({
			kind: "skipped",
			reason: "unchanged-scroll",
		});
		expect(applyRangeMeasurement).toHaveBeenCalledTimes(1);
	});

	it("can force publication when non-scroll inputs changed", () => {
		const { controller, applyRangeMeasurement } = createControllerHarness();

		controller.runScrollMeasurement(ACTIVE_SCROLL_METRICS);
		const result = controller.runScrollMeasurement(
			{ ...ACTIVE_SCROLL_METRICS, frameId: 2 },
			{ forcePublish: true, reason: "data-change" },
		);

		expect(result.kind).toBe("measured");
		expect(applyRangeMeasurement).toHaveBeenCalledTimes(2);
	});

	it("precomputes mounted and preview ranges on the active scroll hot path", () => {
		const state: TestRowModelState = {
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		};
		const { controller, applyRangeMeasurement } = createControllerHarness(state);

		controller.runScrollMeasurement(ACTIVE_SCROLL_METRICS);
		state.previewVisible = { start: 3, end: 9 };
		controller.runScrollMeasurement({
			...ACTIVE_SCROLL_METRICS,
			scrollTop: 70,
			frameId: 2,
		});

		expect(applyRangeMeasurement.mock.calls[1]?.[2]).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 3, end: 9 },
		});
	});

	it("owns coverage and publishes its intersection directly to the observer", () => {
		const { controller, rootEl } = createControllerHarness({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
			mountedCoverageBand: { min: 20, max: 80 },
			previewCoverageBand: { min: 30, max: 70 },
		});
		const cleanup = controller.observeRoot(rootEl);

		controller.runScrollMeasurement(ACTIVE_SCROLL_METRICS);

		expect(
			viewportObservationHarness.publishScrollMeasurementRange,
		).toHaveBeenLastCalledWith({
			minScrollTopBeforeMeasurement: 30,
			maxScrollTopBeforeMeasurement: 70,
		});

		controller.resetScrollWindow();
		controller.runScrollMeasurement(
			{ ...ACTIVE_SCROLL_METRICS, scrollTop: 90, frameId: 2 },
			{ forcePublish: true },
		);
		expect(
			viewportObservationHarness.publishScrollMeasurementRange,
		).toHaveBeenCalledTimes(2);
		cleanup();
	});

	it("does not precompute active-scroll ranges after scroll becomes idle", () => {
		const { controller, applyRangeMeasurement } = createControllerHarness();

		controller.runScrollMeasurement({
			...ACTIVE_SCROLL_METRICS,
			isScrollActive: false,
		});

		expect(applyRangeMeasurement).toHaveBeenCalledOnce();
		expect(applyRangeMeasurement.mock.calls[0]?.[2]).toBeUndefined();
	});

	it("suppresses scheduled scroll work while layout measurement is pending", async () => {
		const { controller, applyRangeMeasurement } = createControllerHarness();

		controller.scheduleLayoutMeasurement();
		controller.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();

		expect(applyRangeMeasurement).toHaveBeenCalledTimes(1);
		expect(applyRangeMeasurement.mock.calls[0]?.[0]?.source).toBe("layout");

		controller.scheduleScrollMeasurement();
		await vi.runAllTimersAsync();
		expect(applyRangeMeasurement).toHaveBeenCalledTimes(2);
	});
});
