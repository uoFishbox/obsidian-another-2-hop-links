import { describe, expect, it, vi } from "vitest";
import {
	createVirtualScrollWindowRangeResolver,
	type VirtualScrollWindowRangeRowModel,
} from "../scrollWindowResolver";
import type { MutableVirtualRanges } from "cards/virtualization/model/types";

function writeEmptyRanges(out: MutableVirtualRanges): void {
	out.mounted.start = 0;
	out.mounted.end = 0;
	out.previewVisible.start = 0;
	out.previewVisible.end = 0;
}

function createEmptyRangeRowModel(
	rowCount: number,
	totalHeight: number,
): VirtualScrollWindowRangeRowModel {
	return {
		rowCount,
		totalHeight,
		findVisibleRangesInto(out, params) {
			if (
				rowCount === 0 ||
				params.scrollTop + params.viewportHeight <= 0 ||
				params.scrollTop >= totalHeight
			) {
				writeEmptyRanges(out);
				return;
			}

			out.mounted.start = 0;
			out.mounted.end = 1;
			out.previewVisible.start = 0;
			out.previewVisible.end = 1;
		},
	};
}

describe("createVirtualScrollWindowRangeResolver", () => {
	it("resolves mounted, preview, and coverage from one atomic range call", () => {
		const findVisibleRangesInto = vi.fn<
			VirtualScrollWindowRangeRowModel["findVisibleRangesInto"]
		>((out) => {
			out.mounted.start = 0;
			out.mounted.end = 10;
			out.previewVisible.start = 2;
			out.previewVisible.end = 8;
		});
		const coverageRanges: Array<{ start: number; end: number }> = [];
		const rowModel: VirtualScrollWindowRangeRowModel = {
			rowCount: 100,
			totalHeight: 10_000,
			findVisibleRangesInto,
			findMountedCoverageScrollTopBandInto(out, { mounted }) {
				coverageRanges.push({ start: mounted.start, end: mounted.end });
				out.min = mounted.start * 10;
				out.max = mounted.end * 10;
			},
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 100,
				previewOverscanPx: 10,
			}),
		});

		const measurement = resolver.resolveScrollWindowMeasurement(
			250,
			120,
			50,
			{},
		);

		expect(findVisibleRangesInto).toHaveBeenCalledOnce();
		expect(findVisibleRangesInto).toHaveBeenCalledWith(expect.anything(), {
			scrollTop: 200,
			viewportHeight: 120,
			mountedOverscanPx: 100,
			previewOverscanPx: 10,
		});
		expect(measurement.ranges).toEqual({
			mounted: { start: 0, end: 10 },
			previewVisible: { start: 2, end: 8 },
		});
		expect(coverageRanges).toEqual([
			{ start: 0, end: 10 },
			{ start: 2, end: 8 },
		]);
		expect(measurement.mountedCoverageScrollTopBand).toEqual({
			min: 50,
			max: 150,
		});
		expect(measurement.previewCoverageScrollTopBand).toEqual({
			min: 70,
			max: 130,
		});
	});

	it("re-resolves direct measurements without a lower-level scroll band cache", () => {
		const findVisibleRangesInto = vi.fn<
			VirtualScrollWindowRangeRowModel["findVisibleRangesInto"]
		>((out) => {
			out.mounted.start = 10;
			out.mounted.end = 20;
			out.previewVisible.start = 12;
			out.previewVisible.end = 18;
		});
		const rowModel: VirtualScrollWindowRangeRowModel = {
			rowCount: 100,
			totalHeight: 10_000,
			findVisibleRangesInto,
		};
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 100,
			}),
		});

		const first = resolver.resolveScrollWindowMeasurement(100, 100, 0, {}).ranges;
		const second = resolver.resolveScrollWindowMeasurement(101, 100, 0, {}).ranges;

		expect(findVisibleRangesInto).toHaveBeenCalledTimes(2);
		expect(second).toBe(first);
	});

	it("publishes absolute coverage bands for empty ranges outside the section", () => {
		const rowModel = createEmptyRangeRowModel(10, 1_000);
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
			}),
		});

		const above = resolver.resolveScrollWindowMeasurement(300, 100, 500, {});
		expect(above.ranges.mounted).toEqual({ start: 0, end: 0 });
		expect(above.mountedCoverageScrollTopBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: 400,
		});

		const below = resolver.resolveScrollWindowMeasurement(1_600, 100, 500, {});
		expect(below.ranges.mounted).toEqual({ start: 0, end: 0 });
		expect(below.mountedCoverageScrollTopBand).toEqual({
			min: 1_500,
			max: Number.POSITIVE_INFINITY,
		});
	});

	it("covers every finite scroll position when the row model is empty", () => {
		const rowModel = createEmptyRangeRowModel(0, 0);
		const resolver = createVirtualScrollWindowRangeResolver({
			resolveRowModel: () => rowModel,
			resolveVisibilityPolicy: () => ({
				bootstrapRows: 1,
				mountedOverscanPx: 0,
			}),
		});

		const measurement = resolver.resolveScrollWindowMeasurement(
			12_345,
			100,
			500,
			{},
		);

		expect(measurement.mountedCoverageScrollTopBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: Number.POSITIVE_INFINITY,
		});
		expect(measurement.previewCoverageScrollTopBand).toEqual({
			min: Number.NEGATIVE_INFINITY,
			max: Number.POSITIVE_INFINITY,
		});
	});

	it("publishes value-stable ranges without reallocating unchanged snapshots", () => {
		const rowModel: VirtualScrollWindowRangeRowModel = {
			rowCount: 100,
			totalHeight: 10_000,
			findVisibleRangesInto(out, params) {
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
});
