import { describe, expect, it } from "vitest";
import { createFlatGridCellSource } from "../cellSource";
import { computeFlatGridLayout } from "cards/virtualization/public";
import { createFlatGridRowModel } from "../rowModel";

type TestItem = { id: string };

const createRowModel = (itemCount: number) => {
	const items = Array.from({ length: itemCount }, (_, index) => ({
		id: `item-${index}`,
	}));
	const cellSource = createFlatGridCellSource({
		header: false,
		items,
		visibleCount: items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "flat-link-row-model",
	});
	const layout = computeFlatGridLayout({
		containerWidth: 320,
		minCellWidth: 100,
		gap: 10,
		maxColumns: 3,
		rowHeight: 100,
		cellCount: cellSource.cellCount,
	});

	return createFlatGridRowModel<TestItem>({ cellSource, layout });
};

describe("flatLinkRowModel", () => {
	it("resolves row cell counts arithmetically without a per-row lookup table", () => {
		const rowModel = createRowModel(8);

		expect(rowModel.getRow(0)?.cellCount).toBe(3);
		expect(rowModel.getRow(1)?.cellCount).toBe(3);
		expect(rowModel.getRow(2)?.cellCount).toBe(2);
		expect(rowModel.getRow(-1)).toBeNull();
		expect(rowModel.getRow(3)).toBeNull();
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

		rowModel.findVisibleRangesInto(rangesScratch, {
			scrollTop: 110,
			viewportHeight: 100,
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});

		expect(rangesScratch).toEqual({
			mounted: { start: 0, end: 3 },
			previewVisible: { start: 0, end: 3 },
		});
		expect(rangesScratch.mounted).toBe(mountedScratch);
		expect(rangesScratch.previewVisible).toBe(previewScratch);
	});

	it("resolves the scroll band covered by the resident mounted range", () => {
		const rowModel = createRowModel(60);
		const mounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(mounted, {
			scrollTop: 220,
			viewportHeight: 100,
			overscanPx: 110,
		});
		const coverageBand = { min: Number.NaN, max: Number.NaN };

		rowModel.findMountedCoverageScrollTopBandInto(coverageBand, {
			viewportHeight: 100,
			mounted,
			requiredOverscanPx: 0,
		});

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

	it("ends preview coverage before the strict viewport can leave preview rows", () => {
		const rowModel = createRowModel(30);
		const ranges = {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		};
		rowModel.findVisibleRangesInto(ranges, {
			scrollTop: 0,
			viewportHeight: 100,
			mountedOverscanPx: 220,
			previewOverscanPx: 110,
		});
		const previewCoverageBand = { min: Number.NaN, max: Number.NaN };

		rowModel.findMountedCoverageScrollTopBandInto(previewCoverageBand, {
			viewportHeight: 100,
			mounted: ranges.previewVisible,
			requiredOverscanPx: 0,
		});

		expect(ranges).toEqual({
			mounted: { start: 0, end: 3 },
			previewVisible: { start: 0, end: 2 },
		});
		expect(previewCoverageBand.max).toBe(121);

		const strictAtBoundary = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(strictAtBoundary, {
			scrollTop: previewCoverageBand.max,
			viewportHeight: 100,
			overscanPx: 0,
		});
		expect(strictAtBoundary).toEqual({ start: 1, end: 3 });
		expect(strictAtBoundary.end).toBeGreaterThan(ranges.previewVisible.end);
	});
	it("resolves sequential focus across physical row boundaries by logical index", () => {
		const rowModel = createRowModel(8);
		const current = rowModel.resolveCellAtIndex(2);
		const next = rowModel.resolveCellAtIndex(3);
		const previous = rowModel.resolveCellAtIndex(1);
		expect(current).toBeTruthy();
		expect(next).toBeTruthy();
		expect(previous).toBeTruthy();
		if (!current || !next || !previous) return;

		expect(
			rowModel.resolveSequentialNavigationTarget?.(current.key, "forward", {
				rowIndex: 0,
				columnIndex: 2,
			}),
		).toEqual({
			key: next.key,
			rowTop: 110,
			rowIndex: 1,
			columnIndex: 0,
		});
		expect(
			rowModel.resolveSequentialNavigationTarget?.(current.key, "backward", {
				rowIndex: 0,
				columnIndex: 2,
			}),
		).toEqual({
			key: previous.key,
			rowTop: 0,
			rowIndex: 0,
			columnIndex: 1,
		});
	});
});
