import { describe, expect, it } from "vitest";
import { createFlatLogicalCellSource } from "../../flatLogicalCellSource";
import { computeVirtualGridLayout } from "../../layout/flatGridLayout";
import { createFlatLinkRowModel } from "../flatLinkRowModel";

type TestItem = { id: string };

const createRowModel = (itemCount: number) => {
	const items = Array.from({ length: itemCount }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatLogicalCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getKey: (item) => item.id,
		sectionId: "flat-link-row-model",
	});
	const layout = computeVirtualGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatLinkRowModel<TestItem>({ cellSource, layout });
};

describe("flatLinkRowModel", () => {
	it("resolves row cell counts arithmetically without a per-row lookup table", () => {
		const rowModel = createRowModel(8);

		expect(rowModel.rowCellCountByRow).toBeUndefined();
		expect(rowModel.getRowCellCount(0)).toBe(3);
		expect(rowModel.getRowCellCount(1)).toBe(3);
		expect(rowModel.getRowCellCount(2)).toBe(2);
		expect(rowModel.getRowCellCount(-1)).toBe(0);
		expect(rowModel.getRowCellCount(3)).toBe(0);
		expect(rowModel.getRow(2)?.cellCount).toBe(2);
	});

	it("writes visible ranges into caller-owned scratch objects", () => {
		const rowModel = createRowModel(30);
		const mountedScratch = { start: -1, end: -1 };
		const previewScratch = { start: -1, end: -1 };
		const rangesScratch = {
			mounted: mountedScratch,
			previewVisible: previewScratch,
		};

		rowModel.findVisibleRangesInto(rangesScratch, {
			scrollTop: 110,
			viewportHeight: 100,
			mountedOverscanPx: 110,
			previewOverscanPx: 0,
		});

		expect(rangesScratch).toEqual({
			mounted: { start: 0, end: 3 },
			previewVisible: { start: 1, end: 2 },
		});
		expect(rangesScratch.mounted).toBe(mountedScratch);
		expect(rangesScratch.previewVisible).toBe(previewScratch);

		rowModel.findVisibleRangesFromMountedInto(rangesScratch, {
			scrollTop: 110,
			viewportHeight: 100,
			mounted: { start: 2, end: 5 },
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});

		expect(rangesScratch).toEqual({
			mounted: { start: 2, end: 5 },
			previewVisible: { start: 2, end: 5 },
		});
		expect(rangesScratch.mounted).toBe(mountedScratch);
		expect(rangesScratch.previewVisible).toBe(previewScratch);
	});

	it("reuses the mounted range reference when preview overscan matches mounted overscan", () => {
		const rowModel = createRowModel(30);
		const ranges = rowModel.findVisibleRanges({
			scrollTop: 110,
			viewportHeight: 100,
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});
		const mounted = { start: 2, end: 5 };
		const rangesFromMounted = rowModel.findVisibleRangesFromMounted({
			scrollTop: 110,
			viewportHeight: 100,
			mounted,
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});

		expect(ranges.previewVisible).toBe(ranges.mounted);
		expect(rangesFromMounted.previewVisible).toBe(mounted);
	});

	it("resolves a stable scroll band for the flat mounted range", () => {
		const rowModel = createRowModel(60);
		const mounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(mounted, {
			scrollTop: 220,
			viewportHeight: 100,
			overscanPx: 110,
		});
		const mountedBand = { min: Number.NaN, max: Number.NaN };

		rowModel.findStableMountedScrollTopBandInto(mountedBand, {
			mountedOverscanPx: 110,
			viewportHeight: 100,
			mounted,
		});

		expect(Number.isFinite(mountedBand.min)).toBe(true);
		expect(Number.isFinite(mountedBand.max)).toBe(true);
		expect(mountedBand.min).toBeLessThan(mountedBand.max);

		const insideMounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(insideMounted, {
			scrollTop: (mountedBand.min + mountedBand.max) / 2,
			viewportHeight: 100,
			overscanPx: 110,
		});
		expect(insideMounted).toEqual(mounted);

		const beyondMounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(beyondMounted, {
			scrollTop: mountedBand.max + 110,
			viewportHeight: 100,
			overscanPx: 110,
		});
		expect(beyondMounted).not.toEqual(mounted);
	});

	it("resolves the wider scroll band covered by the resident mounted range", () => {
		const rowModel = createRowModel(60);
		const mounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(mounted, {
			scrollTop: 220,
			viewportHeight: 100,
			overscanPx: 110,
		});
		const stableBand = { min: Number.NaN, max: Number.NaN };
		const coverageBand = { min: Number.NaN, max: Number.NaN };

		rowModel.findStableMountedScrollTopBandInto(stableBand, {
			mountedOverscanPx: 110,
			viewportHeight: 100,
			mounted,
		});
		rowModel.findMountedCoverageScrollTopBandInto(coverageBand, {
			viewportHeight: 100,
			mounted,
			requiredOverscanPx: 0,
		});

		expect(coverageBand.min).toBeLessThan(stableBand.min);
		expect(coverageBand.max).toBeGreaterThan(stableBand.max);

		const requiredAtLowerEdge = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(requiredAtLowerEdge, {
			scrollTop: coverageBand.min,
			viewportHeight: 100,
			overscanPx: 0,
		});
		expect(requiredAtLowerEdge.start).toBe(mounted.start);

		const requiredBeforeLowerEdge = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(requiredBeforeLowerEdge, {
			scrollTop: coverageBand.min - 1,
			viewportHeight: 100,
			overscanPx: 0,
		});
		expect(requiredBeforeLowerEdge.start).toBeLessThan(mounted.start);

		const requiredAtUpperEdge = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(requiredAtUpperEdge, {
			scrollTop: coverageBand.max,
			viewportHeight: 100,
			overscanPx: 0,
		});
		expect(requiredAtUpperEdge.end).toBeGreaterThan(mounted.end);
	});
});
