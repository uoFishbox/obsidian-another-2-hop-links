import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualScrollWindowRangeRowModel } from "../../core/scrollWindowMeasurement";
import type {
	ScrollMeasurementRange,
	StableScrollTopBand,
} from "../../core/scrollWindowGate";
import type { VirtualVisibilityPolicy } from "../../core/virtualListEngine";
import type { MeasurementUpdateResult } from "../../dom/virtualListMeasurementAdapter";
import type {
	CreateVirtualMeasurementControllerOptions,
	VirtualMeasurement,
	VirtualMeasurementApplicationResult,
} from "../../dom/virtualMeasurementController";
import type { RowRange } from "../../rowRange";
import type { VirtualRanges } from "../../types";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";

const measurementControllerHarness = vi.hoisted(() => ({
	options: null as CreateVirtualMeasurementControllerOptions | null,
}));

vi.mock("../../dom/virtualMeasurementController", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../dom/virtualMeasurementController")>();
	return {
		...actual,
		createVirtualMeasurementController: (
			options: CreateVirtualMeasurementControllerOptions,
		) => {
			measurementControllerHarness.options = options;
			return {
				hasPendingLayoutMeasurement: vi.fn(() => false),
				observeRoot: vi.fn(() => vi.fn()),
				runLayoutMeasurement: vi.fn(),
				runScrollMeasurement: vi.fn(),
				scheduleLayoutMeasurement: vi.fn(),
				scheduleScrollMeasurement: vi.fn(),
				scheduleScrollMeasurementAfterLayout: vi.fn(),
			};
		},
	};
});

import { createVirtualListControllerAdapter } from "../virtualListControllerAdapter";

const STABLE_MEASUREMENT: VirtualMeasurement = {
	scrollTop: 50,
	viewportHeight: 100,
	sectionTop: 0,
	isStableMeasurement: true,
	isScrollActive: true,
	scrollGeneration: 1,
	source: "scroll",
};

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
	stableMountedBand?: StableScrollTopBand;
	mountedCoverageBand?: StableScrollTopBand;
	previewCoverageBand?: StableScrollTopBand;
}

interface AdapterHarness {
	applyRanges: ReturnType<typeof vi.fn>;
	applyScrollMeasurement(
		measurement?: VirtualMeasurement,
	): VirtualMeasurementApplicationResult | void;
	getScrollMeasurementRange(): ScrollMeasurementRange | null;
	resetScrollWindow(): void;
}

const copyRange = (out: RowRange, range: RowRange): void => {
	out.start = range.start;
	out.end = range.end;
};

const createTestRowModel = (
	state: TestRowModelState,
): VirtualScrollWindowRangeRowModel => ({
	get rowCount() {
		return state.rowCount ?? 100;
	},
	get totalHeight() {
		return state.totalHeight ?? 1_000;
	},
	findVisibleRangeInto(out) {
		copyRange(out, state.mounted);
	},
	findVisibleRangesInto(out) {
		copyRange(out.mounted, state.mounted);
		copyRange(out.previewVisible, state.previewVisible);
	},
	findVisibleRangesFromMountedInto(out, { mounted }) {
		copyRange(out.mounted, mounted);
		copyRange(out.previewVisible, state.previewVisible);
	},
	findStableMountedScrollTopBandInto(out) {
		out.min = state.stableMountedBand?.min ?? Number.POSITIVE_INFINITY;
		out.max = state.stableMountedBand?.max ?? Number.NEGATIVE_INFINITY;
	},
	findMountedCoverageScrollTopBandInto(out, { mounted }) {
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

const createAdapterHarness = (
	state: TestRowModelState,
	applyRangeMeasurement: (
		measurement: VirtualMeasurement,
		context: VirtualScrollWindowRangeRowModel,
		precomputedRanges?: VirtualRanges,
	) => MeasurementUpdateResult<RowRange> = () => ({
		kind: "stable",
		range: { start: 0, end: 0 },
	}),
): AdapterHarness => {
	const rowModel = createTestRowModel(state);
	const applyRanges = vi.fn(applyRangeMeasurement);
	const adapter = createVirtualListControllerAdapter({
		getRootEl: () => null,
		measurement: {
			sectionTop: 0,
			viewportHeight: 100,
			hasStableScrollMetrics: true,
			hasStableVisibleRange: true,
			measuredWidth: null,
			scrollContainerEl: null,
			invalidateViewport: vi.fn(),
			updateFromLiveMetrics: vi.fn(),
			resolvePhase: () => ({
				type: "stable",
				sectionTop: 0,
				viewportHeight: 100,
				visibleRangeStable: true,
			}),
		},
		getContext: () => rowModel,
		hasRenderableContent: () => true,
		resolveRowModel: (context) => context,
		resolveVisibilityPolicy: () => VISIBILITY_POLICY,
		applyRangeMeasurement: applyRanges,
		resolveLayoutMeasurement: (measurement) => ({
			context: rowModel,
			measurement,
			isStable: true,
		}),
	});

	return {
		applyRanges,
		applyScrollMeasurement(measurement = STABLE_MEASUREMENT) {
			return measurementControllerHarness.options?.onMeasurement?.(measurement);
		},
		getScrollMeasurementRange() {
			return (
				measurementControllerHarness.options?.getScrollMeasurementRange?.() ??
				null
			);
		},
		resetScrollWindow: adapter.resetScrollWindow,
	};
};

describe("createVirtualListControllerAdapter scroll-window orchestration", () => {
	beforeEach(() => {
		measurementControllerHarness.options = null;
	});

	it("exposes the intersection of mounted and published preview coverage", () => {
		const harness = createAdapterHarness({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
			stableMountedBand: { min: 40, max: 60 },
			mountedCoverageBand: { min: 20, max: 80 },
			previewCoverageBand: { min: 30, max: 70 },
		});

		harness.applyScrollMeasurement();

		expect(harness.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 30,
			maxScrollTopBeforeMeasurement: 70,
		});

		harness.resetScrollWindow();
		expect(harness.getScrollMeasurementRange()).toBeNull();
	});

	it("publishes preview changes while reusing an unchanged mounted range", () => {
		const state: TestRowModelState = {
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		};
		const harness = createAdapterHarness(state);

		harness.applyScrollMeasurement();
		state.previewVisible = { start: 3, end: 9 };
		harness.applyScrollMeasurement({ ...STABLE_MEASUREMENT, scrollTop: 70 });

		expect(harness.applyRanges).toHaveBeenCalledTimes(2);
		expect(harness.applyRanges.mock.calls[1]?.[2]).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 3, end: 9 },
		});
	});

	it("classifies same mounted window hits by empty state", () => {
		resetCCLDevMeasurements();
		const harness = createAdapterHarness({
			rowCount: 0,
			totalHeight: 0,
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		});

		harness.applyScrollMeasurement();
		harness.applyScrollMeasurement({ ...STABLE_MEASUREMENT, scrollTop: 60 });

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["virtualScroll.sameMountedWindowHit"].count).toBe(1);
		expect(counters["virtualScroll.sameMountedWindowHit.empty"].count).toBe(1);
		expect(counters["virtualScroll.sameMountedWindowHit.nonEmpty"].count).toBe(0);
	});

	it("does not expose mounted coverage beyond published preview coverage", () => {
		const harness = createAdapterHarness({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
			mountedCoverageBand: { min: 60, max: 80 },
			previewCoverageBand: { min: 65, max: 75 },
		});

		harness.applyScrollMeasurement();

		expect(harness.getScrollMeasurementRange()).toEqual({
			minScrollTopBeforeMeasurement: 65,
			maxScrollTopBeforeMeasurement: 75,
		});
	});

	it("publishes the full range when the mounted range changes", () => {
		const state: TestRowModelState = {
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		};
		const harness = createAdapterHarness(state);

		harness.applyScrollMeasurement();
		state.mounted = { start: 1, end: 11 };
		state.previewVisible = { start: 3, end: 9 };
		harness.applyScrollMeasurement({ ...STABLE_MEASUREMENT, scrollTop: 70 });

		expect(harness.applyRanges).toHaveBeenCalledTimes(2);
		expect(harness.applyRanges.mock.calls[1]?.[2]).toEqual({
			mounted: { start: 1, end: 11 },
			previewVisible: { start: 3, end: 9 },
		});
	});

	it("recomputes ranges through the normal measurement path when scroll becomes idle", () => {
		const harness = createAdapterHarness({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		});

		harness.applyScrollMeasurement({
			...STABLE_MEASUREMENT,
			isScrollActive: false,
		});

		expect(harness.applyRanges).toHaveBeenCalledOnce();
		expect(harness.applyRanges.mock.calls[0]?.[2]).toBeUndefined();
	});
});
