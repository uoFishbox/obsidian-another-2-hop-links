import { describe, expect, it, vi } from "vitest";
import {
	createVirtualScrollWindowRangeResolver,
	type VirtualScrollWindowRangeRowModel,
} from "../scrollWindowMeasurement";
import type { VirtualVisibilityPolicy } from "../../virtualRanges";
import {
	getCCLDevMeasurementSnapshot,
	resetCCLDevMeasurements,
} from "infrastructure/debug/CCLDevMeasurements";

function createRowModel(
	findVisibleRangeInto: () => void,
): VirtualScrollWindowRangeRowModel {
	return {
		rowCount: 100,
		totalHeight: 10_000,
		findVisibleRangeInto(out) {
			findVisibleRangeInto();
			out.start = 10;
			out.end = 20;
		},
		findVisibleRangesInto() {},
		findStableMountedScrollTopBandInto(out) {
			out.min = -1_000;
			out.max = 1_000;
		},
		findMountedCoverageScrollTopBandInto(out) {
			out.min = -2_000;
			out.max = 2_000;
		},
	};
}

function createEmptyRangeRowModel(
	rowCount: number,
	totalHeight: number,
): VirtualScrollWindowRangeRowModel {
	return {
		rowCount,
		totalHeight,
		findVisibleRangeInto(out, params) {
			if (
				rowCount === 0 ||
				params.scrollTop + params.viewportHeight <= 0 ||
				params.scrollTop >= totalHeight
			) {
				out.start = 0;
				out.end = 0;
				return;
			}

			out.start = 0;
			out.end = 1;
		},
		findVisibleRangesInto() {},
	};
}

describe("createVirtualScrollWindowRangeResolver", () => {
	it("invalidates the mounted stable band when its measurement inputs change", () => {
		const findVisibleRangeInto = vi.fn();
		const rowModel = createRowModel(findVisibleRangeInto);
		const layout = {};
		const visibilityPolicy: VirtualVisibilityPolicy = {
			bootstrapRows: 1,
			mountedOverscanPx: 10,
			previewOverscanPx: 0,
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => visibilityPolicy,
			resolveStableMountedScrollTopBand: true,
		});

		const initial = resolver.resolveMountedScrollWindowMeasurement(
			100,
			100,
			0,
			layout,
		);
		resolver.resolveMountedScrollWindowMeasurement(101, 100, 0, layout);
		expect(findVisibleRangeInto).toHaveBeenCalledTimes(1);
		expect(initial.mountedCoverageScrollTopBand).toEqual({
			min: -2_000,
			max: 2_000,
		});

		resolver.resolveMountedScrollWindowMeasurement(102, 120, 0, layout);
		resolver.resolveMountedScrollWindowMeasurement(103, 120, 5, layout);
		visibilityPolicy.mountedOverscanPx = 20;
		resolver.resolveMountedScrollWindowMeasurement(104, 120, 5, layout);

		expect(findVisibleRangeInto).toHaveBeenCalledTimes(4);
	});

	it("derives preview coverage from the published preview range", () => {
		const coverageRange = { start: -1, end: -1 };
		const rowModel: VirtualScrollWindowRangeRowModel = {
			rowCount: 100,
			totalHeight: 10_000,
			findVisibleRangeInto(out) {
				out.start = 0;
				out.end = 10;
			},
			findVisibleRangesInto(out, params) {
				if (!params.mounted) throw new Error("Expected mounted range.");
				out.mounted.start = params.mounted.start;
				out.mounted.end = params.mounted.end;
				out.previewVisible.start = 2;
				out.previewVisible.end = 5;
			},
			findMountedCoverageScrollTopBandInto(out, params) {
				coverageRange.start = params.mounted.start;
				coverageRange.end = params.mounted.end;
				out.min = params.mounted.start * 100;
				out.max = params.mounted.end * 100;
			},
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 1_000,
				previewOverscanPx: 0,
			}),
			resolveStableMountedScrollTopBand: true,
		});

		const measurement = resolver.resolveScrollWindowMeasurement(
			121,
			100,
			0,
			{},
			{ start: 0, end: 10 },
		);

		expect(coverageRange).toEqual({ start: 2, end: 5 });
		expect(measurement.previewCoverageScrollTopBand).toEqual({
			min: 200,
			max: 500,
		});
	});

	it("publishes absolute coverage bands for empty mounted ranges", () => {
		resetCCLDevMeasurements();
		const rowModel = createEmptyRangeRowModel(10, 1_000);
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
			}),
			resolveStableMountedScrollTopBand: true,
		});

		const above = resolver.resolveMountedScrollWindowMeasurement(300, 100, 500, {});
		expect(above.mounted).toEqual({ start: 0, end: 0 });
		expect(above.mountedCoverageScrollTopBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: 400,
		});

		const below = resolver.resolveMountedScrollWindowMeasurement(
			1_600,
			100,
			500,
			{},
		);
		expect(below.mounted).toEqual({ start: 0, end: 0 });
		expect(below.mountedCoverageScrollTopBand).toEqual({
			min: 1_500,
			max: Number.POSITIVE_INFINITY,
		});

		const counters = getCCLDevMeasurementSnapshot().counters;
		expect(counters["virtualScroll.coverageBand.emptyAbove"].count).toBe(1);
		expect(counters["virtualScroll.coverageBand.emptyBelow"].count).toBe(1);
	});

	it("matches the empty-range boundaries used by mounted range resolution", () => {
		const rowModel = createEmptyRangeRowModel(10, 1_000);
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
			}),
			resolveStableMountedScrollTopBand: true,
		});

		const aboveBoundary = resolver.resolveMountedScrollWindowMeasurement(
			400,
			100,
			500,
			{},
		);
		expect(aboveBoundary.mounted).toEqual({ start: 0, end: 0 });
		expect(aboveBoundary.mountedCoverageScrollTopBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: 400,
		});

		const enteredFromAbove = resolver.resolveMountedScrollWindowMeasurement(
			401,
			100,
			500,
			{},
		);
		expect(enteredFromAbove.mounted).toEqual({ start: 0, end: 1 });

		const belowBoundary = resolver.resolveMountedScrollWindowMeasurement(
			1_500,
			100,
			500,
			{},
		);
		expect(belowBoundary.mounted).toEqual({ start: 0, end: 0 });
		expect(belowBoundary.mountedCoverageScrollTopBand).toEqual({
			min: 1_500,
			max: Number.POSITIVE_INFINITY,
		});

		const enteredFromBelow = resolver.resolveMountedScrollWindowMeasurement(
			1_499,
			100,
			500,
			{},
		);
		expect(enteredFromBelow.mounted).toEqual({ start: 0, end: 1 });
	});

	it("covers every finite scroll position when the row model is empty", () => {
		resetCCLDevMeasurements();
		const rowModel = createEmptyRangeRowModel(0, 0);
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
			}),
			resolveStableMountedScrollTopBand: true,
		});

		const measurement = resolver.resolveMountedScrollWindowMeasurement(
			12_345,
			100,
			500,
			{},
		);

		expect(measurement.mountedCoverageScrollTopBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: Number.POSITIVE_INFINITY,
		});
		expect(
			getCCLDevMeasurementSnapshot().counters[
				"virtualScroll.coverageBand.emptyData"
			].count,
		).toBe(1);
	});

	it("publishes value-stable ranges without reallocating unchanged snapshots", () => {
		const rowModel: VirtualScrollWindowRangeRowModel = {
			rowCount: 100,
			totalHeight: 10_000,
			findVisibleRangeInto() {},
			findVisibleRangesInto(out, params) {
				if (params.mounted) {
					out.mounted.start = params.mounted.start;
					out.mounted.end = params.mounted.end;
					out.previewVisible.start = params.mounted.start + 1;
					out.previewVisible.end = params.mounted.end - 1;
					return;
				}
				out.mounted.start = params.scrollTop;
				out.mounted.end = params.scrollTop + 10;
				out.previewVisible.start = params.scrollTop + 1;
				out.previewVisible.end = params.scrollTop + 5;
			},
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
				previewOverscanPx: 0,
			}),
		});

		const first = resolver.resolveScrollWindowMeasurement(10, 100, 0, {}).ranges;
		const unchanged = resolver.resolveScrollWindowMeasurement(
			10,
			100,
			0,
			{},
		).ranges;
		expect(unchanged).toBe(first);

		const second = resolver.resolveScrollWindowMeasurement(20, 100, 0, {}).ranges;
		expect(second).not.toBe(first);
		expect(second).toEqual({
			mounted: { start: 20, end: 30 },
			previewVisible: { start: 21, end: 25 },
		});
		expect(first).toEqual({
			mounted: { start: 10, end: 20 },
			previewVisible: { start: 11, end: 15 },
		});
	});

	it("keeps scroll-branch and committed-branch published ranges isolated", () => {
		const rowModel: VirtualScrollWindowRangeRowModel = {
			rowCount: 100,
			totalHeight: 10_000,
			findVisibleRangeInto() {},
			findVisibleRangesInto(out, params) {
				if (!params.mounted) return;
				out.mounted.start = params.mounted.start;
				out.mounted.end = params.mounted.end;
				out.previewVisible.start = params.mounted.start + 1;
				out.previewVisible.end = params.mounted.end - 1;
			},
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
				previewOverscanPx: 0,
			}),
		});

		const fromMountedFirst = resolver.resolveScrollWindowMeasurement(
			0,
			100,
			0,
			{},
			{
				start: 30,
				end: 40,
			},
		).ranges;
		const fromMountedUnchanged = resolver.resolveScrollWindowMeasurement(
			0,
			100,
			0,
			{},
			{
				start: 30,
				end: 40,
			},
		).ranges;
		expect(fromMountedUnchanged).toBe(fromMountedFirst);

		const fromMountedShifted = resolver.resolveScrollWindowMeasurement(
			0,
			100,
			0,
			{},
			{
				start: 35,
				end: 45,
			},
		).ranges;
		expect(fromMountedShifted).not.toBe(fromMountedFirst);
		expect(fromMountedShifted).toEqual({
			mounted: { start: 35, end: 45 },
			previewVisible: { start: 36, end: 44 },
		});
		expect(fromMountedFirst).toEqual({
			mounted: { start: 30, end: 40 },
			previewVisible: { start: 31, end: 39 },
		});
	});
});
