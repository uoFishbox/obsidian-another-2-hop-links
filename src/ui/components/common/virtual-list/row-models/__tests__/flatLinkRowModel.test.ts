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

	it("resolves stable scroll bands for flat mounted and preview ranges", () => {
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

		const ranges = rowModel.findVisibleRanges({
			scrollTop: 220,
			viewportHeight: 100,
			mountedOverscanPx: 110,
			previewOverscanPx: 0,
		});
		const previewBand = { min: Number.NaN, max: Number.NaN };
		rowModel.findStablePreviewScrollTopBandInto(previewBand, {
			viewportHeight: 100,
			mountedOverscanPx: 110,
			previewOverscanPx: 0,
			previewVisible: ranges.previewVisible,
		});

		expect(previewBand.min).toBeLessThan(previewBand.max);
		expect(
			rowModel.findVisibleRanges({
				scrollTop: (previewBand.min + previewBand.max) / 2,
				viewportHeight: 100,
				mountedOverscanPx: 110,
				previewOverscanPx: 0,
			}).previewVisible,
		).toEqual(ranges.previewVisible);
	});
});
