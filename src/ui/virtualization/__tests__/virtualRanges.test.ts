import { describe, expect, it } from "vitest";
import { computeVirtualRanges } from "../virtualRanges";
import type { VirtualRanges, VirtualRowModel, VirtualRowModelRevision } from "../types";

function createMockRowModel(
	rowCount: number,
	rowHeight: number,
): VirtualRowModel<unknown> {
	const revision: VirtualRowModelRevision = { kind: "opaque", token: 0 };
	return {
		revision,
		rowCount,
		totalHeight: rowCount * rowHeight,
		layout: {
			containerWidth: 0,
			columns: 1,
			cellWidth: 0,
			gap: 0,
			rowHeight,
			contentHeight: rowCount * rowHeight,
		},
		getRow: (index) =>
			index < 0 || index >= rowCount
				? null
				: {
						key: index,
						index,
						top: index * rowHeight,
						height: rowHeight,
						bottomSpacing: 0,
						cellCount: 1,
						getCell: () => null,
					},
		findVisibleRange: ({ scrollTop, viewportHeight, overscanPx }) => {
			const start = Math.max(0, Math.floor((scrollTop - overscanPx) / rowHeight));
			const end = Math.min(
				rowCount,
				Math.ceil((scrollTop + viewportHeight + overscanPx) / rowHeight),
			);
			if (start >= end) {
				return { start: 0, end: 0 };
			}
			return { start, end };
		},
	};
}

function expectComputedRanges(
	result: ReturnType<typeof computeVirtualRanges>,
): VirtualRanges {
	expect("ranges" in result).toBe(true);
	if (!("ranges" in result)) {
		throw new Error("Expected computed virtual ranges.");
	}

	return result.ranges;
}

describe("computeVirtualRanges", () => {
	it("returns explicit empty mode when there are no rows", () => {
		const rowModel = createMockRowModel(0, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 0,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
		});

		expect(result).toEqual({
			mode: { kind: "empty", reason: "no-rows" },
			ranges: {
				mounted: { start: 0, end: 0 },
				previewVisible: { start: 0, end: 0 },
			},
		});
	});

	it("returns skipped when measurement is not stable and visible range already exists", () => {
		const rowModel = createMockRowModel(100, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 0,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: false,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
		});
		expect(result).toEqual({
			mode: { kind: "skipped", reason: "unstable-measurement" },
		});
	});

	it("returns bootstrap range when measurement is not stable and no visible range exists", () => {
		const rowModel = createMockRowModel(100, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 0,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: false,
			hasStableVisibleRange: false,
			currentMountedRange: { start: 0, end: 0 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
		});
		expect(result).toEqual({
			mode: { kind: "bootstrapped", reason: "initial" },
			ranges: {
				mounted: { start: 0, end: 5 },
				previewVisible: { start: 0, end: 5 },
			},
		});
	});

	it("returns bootstrap range when unstable measurement has an out-of-bounds current range", () => {
		const rowModel = createMockRowModel(7, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 0,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: false,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 5, end: 10 },
			bootstrapRows: 3,
			mountedOverscanPx: 100,
		});

		expect(result).toEqual({
			mode: { kind: "bootstrapped", reason: "invalid-mounted-range" },
			ranges: {
				mounted: { start: 0, end: 3 },
				previewVisible: { start: 0, end: 3 },
			},
		});
	});

	it("computes visible and mounted ranges for stable measurement", () => {
		const rowModel = createMockRowModel(100, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 200,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
		});

		expect(result.mode.kind).toBe("stable");
		if (result.mode.kind !== "stable") return;
		expect(result.mode.scrolling).toBe(false);
		const ranges = expectComputedRanges(result);

		// visible: rows 4..12 (200..600)
		expect(ranges.previewVisible.start).toBe(4);
		expect(ranges.previewVisible.end).toBe(12);

		// mounted: overscan 100px -> 2 extra rows on each side
		expect(ranges.mounted.start).toBe(2);
		expect(ranges.mounted.end).toBe(14);
	});

	it("expands preview visible range by preview overscan without exceeding mounted overscan", () => {
		const rowModel = createMockRowModel(100, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 200,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
			previewOverscanPx: 50,
		});

		expect(result.mode.kind).toBe("stable");
		const ranges = expectComputedRanges(result);
		expect(ranges.previewVisible).toEqual({ start: 3, end: 13 });
		expect(ranges.mounted).toEqual({ start: 2, end: 14 });
	});

	it("caps preview visible range to mounted overscan", () => {
		const rowModel = createMockRowModel(100, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 200,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 50,
			previewOverscanPx: 150,
		});

		expect(result.mode.kind).toBe("stable");
		const ranges = expectComputedRanges(result);
		expect(ranges.previewVisible).toEqual({ start: 3, end: 13 });
		expect(ranges.mounted).toEqual({ start: 3, end: 13 });
	});

	it("marks stable mode as scrolling while scroll is active", () => {
		const rowModel = createMockRowModel(100, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 200,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
			isScrollActive: true,
		});

		expect(result.mode).toEqual({ kind: "stable", scrolling: true });
	});

	it("uses precomputed ranges for stable measurements", () => {
		const rowModel = {
			...createMockRowModel(100, 50),
			findVisibleRange: () => {
				throw new Error("Expected precomputed ranges to be reused.");
			},
		};
		const precomputedRanges = {
			mounted: { start: 3, end: 11 },
			previewVisible: { start: 4, end: 10 },
		};
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 200,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
			precomputedRanges,
		});

		expect(result.mode.kind).toBe("stable");
		const ranges = expectComputedRanges(result);
		expect(ranges).toEqual(precomputedRanges);
	});

	it("copies precomputed ranges before reusable scratch is overwritten", () => {
		const precomputedRanges = {
			mounted: { start: 3, end: 11 },
			previewVisible: { start: 4, end: 10 },
		};
		const result = computeVirtualRanges({
			rowModel: createMockRowModel(100, 50),
			scrollTop: 200,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 10 },
			bootstrapRows: 5,
			mountedOverscanPx: 100,
			precomputedRanges,
		});
		const ranges = expectComputedRanges(result);

		precomputedRanges.mounted.start = 20;
		precomputedRanges.mounted.end = 30;
		precomputedRanges.previewVisible.start = 21;
		precomputedRanges.previewVisible.end = 29;

		expect(ranges).toEqual({
			mounted: { start: 3, end: 11 },
			previewVisible: { start: 4, end: 10 },
		});
	});

	it("bounds mounted range to row count", () => {
		const rowModel = createMockRowModel(10, 50);
		const result = computeVirtualRanges({
			rowModel,
			scrollTop: 400,
			viewportHeight: 400,
			sectionTop: 0,
			isStableMeasurement: true,
			hasStableVisibleRange: true,
			currentMountedRange: { start: 0, end: 5 },
			bootstrapRows: 5,
			mountedOverscanPx: 1000, // huge overscan
		});

		expect(result.mode.kind).toBe("stable");
		if (result.mode.kind !== "stable") return;
		const ranges = expectComputedRanges(result);

		expect(ranges.mounted.start).toBe(0);
		expect(ranges.mounted.end).toBe(10);
	});
});
