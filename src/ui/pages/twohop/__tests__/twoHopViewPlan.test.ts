import { describe, expect, it, vi } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type {
	TwoHopVirtualListSection,
	TwoHopVirtualListItem,
} from "../twoHopVirtualListModel";
import * as viewPlanModule from "../twoHopViewPlan";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	findTwoHopRowsByOffset,
	findTwoHopRowsByOffsetInto,
	hasUnmaterializedTwoHopSections,
	materializeNextTwoHopCellBatch,
	materializeNextTwoHopSectionBatch,
	resolveTwoHopLogicalCellInSection,
} from "../twoHopViewPlan";
import { buildTwoHopMountedRows } from "../twoHopMountedRowBuild";

const createBatchedMaterialization = (
	maxSectionCount: number,
	maxCellCount = Number.MAX_SAFE_INTEGER,
) =>
	({
		kind: "batched",
		initial: {
			maxSectionCount,
			maxCellCount,
		},
		background: {
			maxCellCountPerSlice: 200,
		},
	}) as const;

const layout = {
	containerWidth: 320,
	columns: 2,
	cellWidth: 140,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

const createItem = (virtualKey: string): TwoHopVirtualListItem => ({
	kind: "new-link",
	item: { type: "link" } as unknown as TwoHopVirtualListItem["item"],
	searchKey: virtualKey,
	virtualKey,
});

const createDescriptor = (
	items: readonly TwoHopVirtualListItem[],
	getItems = vi.fn(() => items),
	sectionId = "new-links",
): SectionRenderDescriptor<TwoHopVirtualListItem, TwoHopVirtualListSection> => {
	const section = {
		kind: "new-links-section",
		rawSectionId: sectionId,
		sectionId,
		sectionKey: sectionId,
		title: "New links",
		getKey: () => "",
	} satisfies TwoHopVirtualListSection;
	return {
		section,
		sectionKey: section.sectionKey,
		title: section.title,
		sectionId: section.sectionId,
		totalCount: items.length,
		loadedCount: items.length,
		getItems,
		getItem: (index) => items[index],
		headerProps: {},
	};
};

describe("compileTwoHopViewPlan", () => {
	it("compiles sections and resolves rows lazily", () => {
		const getItems = vi.fn(() => [
			createItem("a"),
			createItem("b"),
			createItem("c"),
		]);
		const descriptor = createDescriptor(getItems(), getItems);
		getItems.mockClear();
		const plan = compileTwoHopViewPlan({
			sections: [descriptor],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});

		expect(getItems).toHaveBeenCalledTimes(1);
		expect(
			plan.cellStore.logicalCellsBySectionIndex[0].map((cell) => cell?.kind),
		).toEqual(["header", "item", "item", "item"]);
		expect(plan.cellStore.logicalCellsBySectionIndex[0][1]).toMatchObject({
			key: "new-links::item:0",
			sourceKey: "new-links::a",
		});
		expect(plan.rows).toHaveLength(plan.rowCount);
		expect(plan.rows[0]).toMatchObject({
			sectionIndex: 0,
			rowIndexInSection: 0,
			sectionCellStartIndex: 0,
			cellCount: 2,
			top: 0,
		});
		expect(plan.rows[1]).toMatchObject({
			sectionIndex: 0,
			rowIndexInSection: 1,
			top: 110,
		});
		expect(plan).not.toHaveProperty("cells");

		const rowModel = createTwoHopViewPlanRowModel(plan);
		expect(rowModel.getRow(1)?.key).toBe(1);
		expect(rowModel.getRow(0)).toMatchObject({
			top: 0,
			cellCount: 2,
		});
		expect(rowModel.getRow(1)).toMatchObject({
			top: 110,
			cellCount: 2,
		});
		expect(
			rowModel.findVisibleRange({
				scrollTop: 105,
				viewportHeight: 10,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
		expect(getItems).toHaveBeenCalledTimes(1);
		expect(
			rowModel.resolveNavigationTarget?.("", "down", {
				rowIndex: 0,
				columnIndex: 1,
			}),
		).toEqual({
			key: plan.cellStore.logicalCellsBySectionIndex[0][3]?.key,
			rowTop: 110,
		});
	});

	it("includes a load-more cell when visible items are truncated", () => {
		const descriptor = createDescriptor([
			createItem("a"),
			createItem("b"),
			createItem("c"),
		]);
		const plan = compileTwoHopViewPlan({
			sections: [descriptor],
			sectionVisibleCounts: { "new-links": 1 },
			layout,
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});

		expect(
			plan.cellStore.logicalCellsBySectionIndex[0].map((cell) => cell?.kind),
		).toEqual(["header", "item", "load-more"]);
		expect(plan.sections[0].showLoadMore).toBe(true);
	});

	it("resolves section-local cells without a global cell lookup", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a")], undefined, "section-a"),
				createDescriptor([createItem("b")], undefined, "section-b"),
			],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});

		expect(plan.cellStore.materializedSectionByIndex).toEqual([false, false]);
		expect(
			plan.cellStore.logicalCellsBySectionIndex.map(
				(logicalCells) => logicalCells.length,
			),
		).toEqual([2, 2]);
		expect(resolveTwoHopLogicalCellInSection(plan, 1, 1)).toMatchObject({
			kind: "item",
			sourceKey: "section-b::b",
		});
		expect(plan.cellStore.materializedSectionByIndex).toEqual([false, false]);
		expect(
			plan.cellStore.logicalCellsBySectionIndex[1].map((cell) => cell?.kind),
		).toEqual([undefined, "item"]);
		expect(resolveTwoHopLogicalCellInSection(plan, 1, 2)).toBeNull();
		expect(plan).not.toHaveProperty("cells");
	});

	it("reuses the mounted range when preview overscan matches mounted overscan", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a"), createItem("b"), createItem("c")]),
			],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ranges = rowModel.findVisibleRanges({
			scrollTop: 0,
			viewportHeight: 10,
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});
		const mounted = { start: 1, end: 2 };
		const rangesFromMounted = rowModel.findVisibleRangesFromMounted({
			scrollTop: 0,
			viewportHeight: 10,
			mounted,
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});

		expect(ranges.previewVisible).toBe(ranges.mounted);
		expect(rangesFromMounted).toEqual({
			mounted,
			previewVisible: mounted,
		});
		expect(rangesFromMounted.previewVisible).toBe(mounted);
	});

	it("measures preview visibility separately when preview overscan is smaller", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a"), createItem("b"), createItem("c")]),
			],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);

		expect(
			rowModel.findVisibleRangesFromMounted({
				scrollTop: 0,
				viewportHeight: 10,
				mounted: { start: 1, end: 2 },
				mountedOverscanPx: 110,
				previewOverscanPx: 0,
			}),
		).toEqual({
			mounted: { start: 1, end: 2 },
			previewVisible: { start: 0, end: 1 },
		});
	});

	it("writes visible ranges into caller-owned scratch objects", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a"), createItem("b"), createItem("c")]),
			],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const mountedScratch = { start: -1, end: -1 };
		const previewScratch = { start: -1, end: -1 };
		const rangesScratch = {
			mounted: mountedScratch,
			previewVisible: previewScratch,
		};

		rowModel.findVisibleRangesInto(rangesScratch, {
			scrollTop: 0,
			viewportHeight: 10,
			mountedOverscanPx: 110,
			previewOverscanPx: 0,
		});

		expect(rangesScratch).toEqual({
			mounted: { start: 0, end: 2 },
			previewVisible: { start: 0, end: 1 },
		});
		expect(rangesScratch.mounted).toBe(mountedScratch);
		expect(rangesScratch.previewVisible).toBe(previewScratch);

		rowModel.findVisibleRangesFromMountedInto(rangesScratch, {
			scrollTop: 0,
			viewportHeight: 10,
			mounted: { start: 1, end: 2 },
			mountedOverscanPx: 110,
			previewOverscanPx: 110,
		});

		expect(rangesScratch).toEqual({
			mounted: { start: 1, end: 2 },
			previewVisible: { start: 1, end: 2 },
		});
		expect(rangesScratch.mounted).toBe(mountedScratch);
		expect(rangesScratch.previewVisible).toBe(previewScratch);
	});

	it("resolves the stable preview scroll band for a preview range", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a"), createItem("b"), createItem("c")]),
			],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ranges = rowModel.findVisibleRanges({
			scrollTop: 0,
			viewportHeight: 10,
			mountedOverscanPx: 110,
			previewOverscanPx: 0,
		});
		const band = { min: Number.NaN, max: Number.NaN };

		rowModel.findStablePreviewScrollTopBandInto(band, {
			scrollTop: 0,
			viewportHeight: 10,
			mountedOverscanPx: 110,
			previewOverscanPx: 0,
			previewVisible: ranges.previewVisible,
		});

		expect(band).toEqual({ min: -10, max: 100 });
		expect(
			rowModel.findVisibleRanges({
				scrollTop: 1,
				viewportHeight: 10,
				mountedOverscanPx: 110,
				previewOverscanPx: 0,
			}).previewVisible,
		).toEqual(ranges.previewVisible);
		expect(
			rowModel.findVisibleRanges({
				scrollTop: 100,
				viewportHeight: 10,
				mountedOverscanPx: 110,
				previewOverscanPx: 0,
			}).previewVisible,
		).not.toEqual(ranges.previewVisible);
	});

	it("resolves a finite stable mounted scroll band", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a"), createItem("b"), createItem("c")]),
			],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);

		// Resolve the mounted range for scrollTop=0.
		const mounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(mounted, {
			scrollTop: 0,
			viewportHeight: 10,
			overscanPx: 110,
		});

		const band = { min: Number.NaN, max: Number.NaN };
		rowModel.findStableMountedScrollTopBandInto(band, {
			mountedOverscanPx: 110,
			viewportHeight: 10,
			mounted,
		});

		// The band must be finite so the pre-check can actually gate.
		expect(Number.isFinite(band.min)).toBe(true);
		expect(Number.isFinite(band.max)).toBe(true);
		expect(band.min).toBeLessThan(band.max);

		// A scrollTop just inside the band must produce the same mounted range.
		const inside = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(inside, {
			scrollTop: (band.min + band.max) / 2,
			viewportHeight: 10,
			overscanPx: 110,
		});
		expect(inside).toEqual(mounted);

		// A scrollTop beyond the band must produce a different mounted range.
		const beyond = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(beyond, {
			scrollTop: band.max + 200,
			viewportHeight: 10,
			overscanPx: 110,
		});
		expect(beyond).not.toEqual(mounted);
	});

	it("resolves adjacent row tops for a preview band across section boundaries", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a")], undefined, "section-a"),
				createDescriptor([createItem("b")], undefined, "section-b"),
			],
			sectionVisibleCounts: {},
			layout,
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const rowTops = {
			previousStartRowTop: Number.NaN,
			currentStartRowTop: Number.NaN,
			previousEndRowTop: Number.NaN,
			currentEndRowTop: Number.NaN,
		};

		rowModel.resolveRowTopsForBandInto(rowTops, {
			startRow: 1,
			endRow: 2,
		});

		expect(rowTops).toEqual({
			previousStartRowTop: 0,
			currentStartRowTop: 120,
			previousEndRowTop: 120,
			currentEndRowTop: null,
		});
	});

	it("materializes the first ten sections and defers the remaining sections", () => {
		const getItemsBySection = Array.from({ length: 12 }, (_, sectionIndex) =>
			vi.fn(() => [createItem(`item-${sectionIndex}`)]),
		);
		const descriptors = getItemsBySection.map((getItems, sectionIndex) =>
			createDescriptor(getItems(), getItems, `section-${sectionIndex}`),
		);
		for (const getItems of getItemsBySection) getItems.mockClear();

		const batchedPlan = compileTwoHopViewPlan({
			sections: descriptors,
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(10),
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});
		const eagerPlan = compileTwoHopViewPlan({
			sections: descriptors,
			sectionVisibleCounts: {},
			layout,
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});

		expect(getItemsBySection.map((getItems) => getItems.mock.calls.length)).toEqual(
			new Array<number>(12).fill(1),
		);
		expect(batchedPlan.totalHeight).toBe(eagerPlan.totalHeight);
		expect(batchedPlan.rowCount).toBe(eagerPlan.rowCount);
		expect(batchedPlan.cellCount).toBe(eagerPlan.cellCount);
		const batchedRowModel = createTwoHopViewPlanRowModel(batchedPlan);
		const eagerRowModel = createTwoHopViewPlanRowModel(eagerPlan);
		expect(
			Array.from({ length: batchedPlan.rowCount }, (_, rowIndex) =>
				batchedRowModel.getRowTop?.(rowIndex),
			),
		).toEqual(
			Array.from({ length: eagerPlan.rowCount }, (_, rowIndex) =>
				eagerRowModel.getRowTop?.(rowIndex),
			),
		);
		expect(batchedPlan.cellStore.materializedSectionByIndex).toEqual([
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			false,
			false,
		]);
		expect(batchedPlan.cellStore.nextUnmaterializedSectionIndex).toBe(10);
		expect(batchedPlan.cellStore.remainingUnmaterializedSectionCount).toBe(2);
		expect(batchedPlan.cellStore.remainingUnmaterializedCellCount).toBe(4);
		expect(hasUnmaterializedTwoHopSections(batchedPlan)).toBe(true);

		expect(batchedRowModel.getRow(11)?.getCell(1)?.kind).toBe("item");
		expect(batchedPlan.cellStore.materializedSectionByIndex[11]).toBe(false);
		expect(batchedPlan.cellStore.nextUnmaterializedSectionIndex).toBe(10);
		expect(batchedPlan.cellStore.remainingUnmaterializedSectionCount).toBe(2);
		// Synchronous scroll-style materialization must keep the progress
		// bookkeeping in sync with the cache: section 11's item cell was just
		// filled out-of-band, so one fewer cell remains for the background
		// materializer to process.
		expect(batchedPlan.cellStore.materializationStateBySectionIndex[11]).toEqual({
			nextCellIndex: 0,
			materializedCellCount: 1,
		});
		expect(batchedPlan.cellStore.remainingUnmaterializedCellCount).toBe(3);
		expect(getItemsBySection.map((getItems) => getItems.mock.calls.length)).toEqual(
			new Array<number>(12).fill(1),
		);

		expect(
			materializeNextTwoHopSectionBatch(batchedPlan, {
				maxSectionCount: 10,
			}),
		).toBe(true);
		expect(batchedPlan.cellStore.materializedSectionByIndex).toEqual(
			new Array<boolean>(12).fill(true),
		);
		expect(getItemsBySection.map((getItems) => getItems.mock.calls.length)).toEqual(
			new Array<number>(12).fill(1),
		);
		expect(batchedPlan.cellStore.nextUnmaterializedSectionIndex).toBe(12);
		expect(batchedPlan.cellStore.remainingUnmaterializedSectionCount).toBe(0);
		expect(batchedPlan.cellStore.remainingUnmaterializedCellCount).toBe(0);
		expect(hasUnmaterializedTwoHopSections(batchedPlan)).toBe(false);
	});

	it("bounds deferred materialization by cell count", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a")], undefined, "section-a"),
				createDescriptor([createItem("b")], undefined, "section-b"),
				createDescriptor([createItem("c")], undefined, "section-c"),
			],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});

		expect(
			materializeNextTwoHopSectionBatch(plan, {
				maxSectionCount: 10,
				maxCellCount: 3,
			}),
		).toBe(true);
		expect(plan.cellStore.materializedSectionByIndex).toEqual([true, false, false]);
	});

	it("bounds initial materialization by cell count", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a")], undefined, "section-a"),
				createDescriptor([createItem("b")], undefined, "section-b"),
				createDescriptor([createItem("c")], undefined, "section-c"),
			],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(10, 3),
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});

		expect(plan.cellStore.materializedSectionByIndex).toEqual([true, false, false]);
	});

	it("stops deferred materialization when its time budget is exhausted", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a")], undefined, "section-a"),
				createDescriptor([createItem("b")], undefined, "section-b"),
			],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: () => 1,
			clampVisibleCount: (_section, count) => count,
		});
		const shouldContinue = vi
			.fn()
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false);

		expect(
			materializeNextTwoHopSectionBatch(plan, {
				maxSectionCount: 10,
				maxCellCount: 100,
				shouldContinue,
			}),
		).toBe(true);
		expect(plan.cellStore.materializedSectionByIndex).toEqual([false, false]);
		expect(plan.cellStore.materializationStateBySectionIndex[0]).toEqual({
			nextCellIndex: 1,
			materializedCellCount: 1,
		});
		expect(shouldContinue).toHaveBeenCalledTimes(2);
	});

	it("materializes part of an oversized section within the cell budget", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor(
					[createItem("a"), createItem("b"), createItem("c")],
					undefined,
					"oversized",
				),
				createDescriptor([createItem("d")], undefined, "deferred"),
			],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (_section, count) => count,
		});

		expect(
			materializeNextTwoHopSectionBatch(plan, {
				maxSectionCount: 10,
				maxCellCount: 2,
			}),
		).toBe(true);
		expect(plan.cellStore.materializedSectionByIndex).toEqual([false, false]);
		expect(plan.cellStore.materializationStateBySectionIndex[0]).toEqual({
			nextCellIndex: 2,
			materializedCellCount: 2,
		});
	});

	it("builds mounted slots directly from compiled rows and section-local cells", () => {
		const plan = compileTwoHopViewPlan({
			sections: [createDescriptor([createItem("a"), createItem("b")])],
			sectionVisibleCounts: { "new-links": 2 },
			layout,
			resolveInitialSectionVisibleCount: () => 2,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const mounted = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges: {
				mounted: { start: 0, end: 2 },
				previewVisible: { start: 0, end: 2 },
			},
		});

		expect(mounted.rowSlices).toHaveLength(2);
		expect(Object.getOwnPropertyDescriptor(mounted, "cells")?.get).toBeTypeOf(
			"function",
		);
		expect(mounted.cells).toBe(mounted.cells);
		expect(mounted.mountedCellCount).toBe(3);
		expect(mounted.cells.map(({ cell }) => cell.kind)).toEqual([
			"header",
			"item",
			"item",
		]);
		expect(mounted.cells[0].cell).toBe(
			plan.cellStore.logicalCellsBySectionIndex[0][0],
		);
		expect(mounted.rowSlices[0].slotKey).toBe(0);
		expect(mounted.rowSlices[1].slotKey).toBe(1);
		expect(mounted.rowSlices.map(({ key }) => key)).toEqual([0, 1]);

		const scrolled = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 2 },
			ranges: {
				mounted: { start: 1, end: 2 },
				previewVisible: { start: 1, end: 2 },
			},
			previousBuild: mounted,
		});
		expect(scrolled.rowSlices[0].rowIndex).toBe(1);
		expect(scrolled.rowSlices[0].slotKey).toBe(1);
		expect(scrolled.rowSlices[0]).toBe(mounted.rowSlices[1]);
		expect(scrolled.cells[0]).toBe(mounted.cells[2]);
	});

	it("does not index previous cells when scrolling within the same plan", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([
					createItem("a"),
					createItem("b"),
					createItem("c"),
					createItem("d"),
				]),
			],
			sectionVisibleCounts: { "new-links": 4 },
			layout,
			resolveInitialSectionVisibleCount: () => 4,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const mounted = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 2 },
			ranges: {
				mounted: { start: 0, end: 2 },
				previewVisible: { start: 0, end: 2 },
			},
		});
		const reusableCellsByKeyDescriptor = Object.getOwnPropertyDescriptor(
			mounted,
			"reusableCellsByKey",
		);
		const cellsDescriptor = Object.getOwnPropertyDescriptor(mounted, "cells");
		const readReusableCellsByKey = vi.fn(() =>
			reusableCellsByKeyDescriptor?.get?.call(mounted),
		);
		const readCells = vi.fn(() => cellsDescriptor?.get?.call(mounted));
		Object.defineProperty(mounted, "reusableCellsByKey", {
			get: readReusableCellsByKey,
		});
		Object.defineProperty(mounted, "cells", {
			get: readCells,
		});

		const scrolled = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 3 },
			ranges: {
				mounted: { start: 1, end: 3 },
				previewVisible: { start: 1, end: 3 },
			},
			previousBuild: mounted,
		});

		expect(scrolled.rowSlices[0]).toBe(mounted.rowSlices[1]);
		expect(scrolled.rowSlices[1].rowIndex).toBe(2);
		expect(readReusableCellsByKey).not.toHaveBeenCalled();
		expect(readCells).not.toHaveBeenCalled();
		expect(scrolled.reusableCellsByKey.size).toBe(scrolled.cells.length);
	});

	it("reuses same-plan row slices after materialization changes", () => {
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor([createItem("a"), createItem("b"), createItem("c")]),
			],
			sectionVisibleCounts: { "new-links": 3 },
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: () => 3,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const mounted = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 1 },
			ranges: {
				mounted: { start: 0, end: 1 },
				previewVisible: { start: 0, end: 1 },
			},
		});
		const mountedRevision = plan.cellStore.revision;

		expect(
			materializeNextTwoHopSectionBatch(plan, {
				maxCellCount: 3,
			}),
		).toBe(true);
		expect(plan.cellStore.revision).toBeGreaterThan(mountedRevision ?? -1);

		const rebuilt = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 1 },
			ranges: {
				mounted: { start: 0, end: 1 },
				previewVisible: { start: 0, end: 1 },
			},
			previousBuild: mounted,
		});

		// The scroll hot path must stay unaffected by background materialization:
		// revising the plan in place must not invalidate row-slice reuse.
		expect(rebuilt.rowSlices[0]).toBe(mounted.rowSlices[0]);
		expect(rebuilt.cells[0]).toBe(mounted.cells[0]);
	});

	it("indexes previous cells when the plan changes", () => {
		const descriptor = createDescriptor([createItem("a"), createItem("b")]);
		const compilePlan = () =>
			compileTwoHopViewPlan({
				sections: [descriptor],
				sectionVisibleCounts: { "new-links": 2 },
				layout,
				resolveInitialSectionVisibleCount: () => 2,
				clampVisibleCount: (_section, count) => count,
			});
		const mounted = buildTwoHopMountedRows({
			rowModel: createTwoHopViewPlanRowModel(compilePlan()),
			rowRange: { start: 0, end: 2 },
			ranges: {
				mounted: { start: 0, end: 2 },
				previewVisible: { start: 0, end: 2 },
			},
		});
		const reusableCellsByKeyDescriptor = Object.getOwnPropertyDescriptor(
			mounted,
			"reusableCellsByKey",
		);
		const readReusableCellsByKey = vi.fn(() =>
			reusableCellsByKeyDescriptor?.get?.call(mounted),
		);
		Object.defineProperty(mounted, "reusableCellsByKey", {
			get: readReusableCellsByKey,
		});

		buildTwoHopMountedRows({
			rowModel: createTwoHopViewPlanRowModel(compilePlan()),
			rowRange: { start: 0, end: 2 },
			ranges: {
				mounted: { start: 0, end: 2 },
				previewVisible: { start: 0, end: 2 },
			},
			previousBuild: mounted,
		});

		expect(readReusableCellsByKey).toHaveBeenCalled();
	});
});

describe("findTwoHopRowsByOffset", () => {
	const sections = [{ top: 0, firstRowIndex: 0, rowCount: 3 }] as never;

	it("calculates the row index within a section", () => {
		expect(
			findTwoHopRowsByOffset({
				sections,
				rowHeight: 50,
				rowGap: 10,
				scrollTop: 55,
				viewportHeight: 60,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
	});

	it("writes into the provided row range", () => {
		const out = { start: -1, end: -1 };

		findTwoHopRowsByOffsetInto(out, {
			sections,
			rowHeight: 50,
			rowGap: 10,
			scrollTop: 55,
			viewportHeight: 60,
			overscanPx: 0,
		});

		expect(out).toEqual({ start: 1, end: 2 });
	});

	it("excludes rows that only touch the viewport boundaries", () => {
		expect(
			findTwoHopRowsByOffset({
				sections,
				rowHeight: 50,
				rowGap: 10,
				scrollTop: 50,
				viewportHeight: 70,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
	});

	it("finds sections across section margins", () => {
		expect(
			findTwoHopRowsByOffset({
				sections: [
					{ top: 0, firstRowIndex: 0, rowCount: 2 },
					{ top: 200, firstRowIndex: 2, rowCount: 2 },
				] as never,
				rowHeight: 50,
				rowGap: 10,
				scrollTop: 170,
				viewportHeight: 40,
				overscanPx: 0,
			}),
		).toEqual({ start: 2, end: 3 });
	});

	it("excludes the next section when the viewport end matches its top", () => {
		expect(
			findTwoHopRowsByOffset({
				sections: [
					{ top: 0, firstRowIndex: 0, rowCount: 2 },
					{ top: 200, firstRowIndex: 2, rowCount: 2 },
				] as never,
				rowHeight: 50,
				rowGap: 10,
				scrollTop: 60,
				viewportHeight: 140,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
	});

	it("returns no rows for zero-height sections", () => {
		expect(
			findTwoHopRowsByOffset({
				sections: [
					{ top: 0, firstRowIndex: 0, rowCount: 1 },
					{ top: 0, firstRowIndex: 1, rowCount: 1 },
				] as never,
				rowHeight: 0,
				rowGap: 0,
				scrollTop: 0,
				viewportHeight: 10,
				overscanPx: 0,
			}),
		).toEqual({ start: 0, end: 0 });
	});
});

describe("materializeNextTwoHopCellBatch affected row range", () => {
	it("reports null when nothing is materialized", () => {
		const plan = compileTwoHopViewPlan({
			sections: [createDescriptor([createItem("a")], undefined, "section-a")],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (_section, count) => count,
		});
		expect(materializeNextTwoHopCellBatch(plan, { maxCellCount: 0 })).toEqual({
			changed: false,
			affectedRowRange: null,
		});
	});

	it("reports the row range that gained cells across one section", () => {
		// columns = 2: header loads on row 0; the two items share row 0 with it.
		const items = [createItem("a"), createItem("b")];
		const plan = compileTwoHopViewPlan({
			sections: [createDescriptor(items, undefined, "section-a")],
			sectionVisibleCounts: { "section-a": 2 },
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: () => 2,
			clampVisibleCount: (_section, count) => count,
		});

		// columns = 2; header + 2 items -> cellCount 3 -> rows 0 (header, item0)
		// and 1 (item1). First batch materializes only the header (row 0).
		expect(materializeNextTwoHopCellBatch(plan, { maxCellCount: 1 })).toEqual({
			changed: true,
			affectedRowRange: { start: 0, end: 1 },
		});
		// Next two cells are the items; item0 is on row 0, item1 on row 1.
		expect(materializeNextTwoHopCellBatch(plan, { maxCellCount: 5 })).toEqual({
			changed: true,
			affectedRowRange: { start: 0, end: 2 },
		});
	});

	it("extends the affected range across rows and sections", () => {
		// columns = 2; each section is header(row0) + 3 items => rows 0-1.
		const plan = compileTwoHopViewPlan({
			sections: [
				createDescriptor(
					[createItem("a"), createItem("b"), createItem("c")],
					undefined,
					"section-a",
				),
				createDescriptor([createItem("d")], undefined, "section-b"),
			],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (_section, count) => count,
		});
		// section-a spans rows 0-1 (cells 0..3), section-b header starts row 2.
		// Materialize everything in one batch: rows 0..2 (exclusive 3).
		expect(materializeNextTwoHopCellBatch(plan, { maxCellCount: 128 })).toEqual({
			changed: true,
			affectedRowRange: { start: 0, end: 3 },
		});
	});
});

describe("scroll-driven materialization keeps bookkeeping in sync", () => {
	it("does not double-count cells materialized by the scroll path", () => {
		// columns = 2; one section with header + 6 items => cellCount 7 over
		// rows 0 (cells 0,1), 1 (cells 2,3), 2 (cells 4,5), 3 (cell 6).
		const items = [
			createItem("a"),
			createItem("b"),
			createItem("c"),
			createItem("d"),
			createItem("e"),
			createItem("f"),
		];
		const plan = compileTwoHopViewPlan({
			sections: [createDescriptor(items, undefined, "section-a")],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (_section, count) => count,
		});
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const state = plan.cellStore.materializationStateBySectionIndex[0];

		expect(plan.cellStore.remainingUnmaterializedCellCount).toBe(7);
		expect(state).toEqual({ nextCellIndex: 0, materializedCellCount: 0 });

		// Simulate a deep scroll: the mounted-row builder synchronously
		// materializes cells for late rows before the idle/background task
		// reaches them.
		const lateRowRange = { start: 2, end: 4 };
		buildTwoHopMountedRows({
			rowModel,
			rowRange: lateRowRange,
			ranges: { mounted: lateRowRange, previewVisible: lateRowRange },
		});

		const lateCells = plan.cellStore.logicalCellsBySectionIndex[0];
		const scrollCell4 = lateCells[4];
		const scrollCell6 = lateCells[6];
		expect(scrollCell4?.kind).toBe("item");
		expect(scrollCell6?.kind).toBe("item");
		// Rows 2-3 cover cells 4,5,6; the bookkeeping counts exactly those.
		expect(state).toEqual({ nextCellIndex: 0, materializedCellCount: 3 });
		expect(plan.cellStore.remainingUnmaterializedCellCount).toBe(4);
		expect(plan.cellStore.materializedSectionByIndex).toEqual([false]);

		// The background materializer walks the remaining prefix (cells 0-3)
		// and must fast-forward past the scroll-materialized tail without
		// re-counting them, so the sync cells are not overwritten.
		const result = materializeNextTwoHopCellBatch(plan, { maxCellCount: 7 });
		expect(result).toEqual({
			changed: true,
			affectedRowRange: { start: 0, end: 2 },
		});
		expect(state).toEqual({ nextCellIndex: 4, materializedCellCount: 7 });
		expect(plan.cellStore.remainingUnmaterializedCellCount).toBe(0);
		expect(plan.cellStore.materializedSectionByIndex).toEqual([true]);
		expect(plan.cellStore.nextUnmaterializedSectionIndex).toBe(1);
		// The scroll-materialized cells were not re-created by the background.
		expect(plan.cellStore.logicalCellsBySectionIndex[0][4]).toBe(scrollCell4);
		expect(plan.cellStore.logicalCellsBySectionIndex[0][6]).toBe(scrollCell6);

		expect(hasUnmaterializedTwoHopSections(plan)).toBe(false);
		expect(materializeNextTwoHopCellBatch(plan, { maxCellCount: 7 })).toEqual({
			changed: false,
			affectedRowRange: null,
		});
	});
});

describe("buildTwoHopMountedRows diff materialization", () => {
	const createLargePlan = () => {
		const items = Array.from({ length: 40 }, (_, i) => createItem(`item-${i}`));
		return compileTwoHopViewPlan({
			sections: [createDescriptor(items, undefined, "section-a")],
			sectionVisibleCounts: {},
			layout,
			materialization: createBatchedMaterialization(0),
			resolveInitialSectionVisibleCount: (section) => section.loadedCount,
			clampVisibleCount: (_section, count) => count,
		});
	};

	it("materializes only the trailing tail on forward scroll", () => {
		const plan = createLargePlan();
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ensureSpy = vi.spyOn(
			viewPlanModule,
			"ensureTwoHopMountedRangeMaterialized",
		);

		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 10 },
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 0, end: 10 },
			},
		});
		ensureSpy.mockClear();

		buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 11 },
			ranges: {
				mounted: { start: 1, end: 11 },
				previewVisible: { start: 1, end: 11 },
			},
			previousBuild: first,
		});

		expect(ensureSpy).toHaveBeenCalledTimes(1);
		expect(ensureSpy).toHaveBeenCalledWith(plan, 10, 11);
		ensureSpy.mockRestore();
	});

	it("materializes only the leading tail on backward scroll", () => {
		const plan = createLargePlan();
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ensureSpy = vi.spyOn(
			viewPlanModule,
			"ensureTwoHopMountedRangeMaterialized",
		);

		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 11 },
			ranges: {
				mounted: { start: 1, end: 11 },
				previewVisible: { start: 1, end: 11 },
			},
		});
		ensureSpy.mockClear();

		buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 10 },
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 0, end: 10 },
			},
			previousBuild: first,
		});

		expect(ensureSpy).toHaveBeenCalledTimes(1);
		expect(ensureSpy).toHaveBeenCalledWith(plan, 0, 1);
		ensureSpy.mockRestore();
	});

	it("falls back to full materialization on non-contiguous jump", () => {
		const plan = createLargePlan();
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ensureSpy = vi.spyOn(
			viewPlanModule,
			"ensureTwoHopMountedRangeMaterialized",
		);

		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 5 },
			ranges: {
				mounted: { start: 0, end: 5 },
				previewVisible: { start: 0, end: 5 },
			},
		});
		ensureSpy.mockClear();

		buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 10, end: 15 },
			ranges: {
				mounted: { start: 10, end: 15 },
				previewVisible: { start: 10, end: 15 },
			},
			previousBuild: first,
		});

		expect(ensureSpy).toHaveBeenCalledTimes(1);
		expect(ensureSpy).toHaveBeenCalledWith(plan, 10, 15);
		ensureSpy.mockRestore();
	});

	it("skips materialization when the range is unchanged", () => {
		const plan = createLargePlan();
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ensureSpy = vi.spyOn(
			viewPlanModule,
			"ensureTwoHopMountedRangeMaterialized",
		);

		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 10 },
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 0, end: 10 },
			},
		});
		ensureSpy.mockClear();

		buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 10 },
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 0, end: 10 },
			},
			previousBuild: first,
		});

		expect(ensureSpy).not.toHaveBeenCalled();
		ensureSpy.mockRestore();
	});

	it("materializes both tails when range expands on both sides", () => {
		const plan = createLargePlan();
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ensureSpy = vi.spyOn(
			viewPlanModule,
			"ensureTwoHopMountedRangeMaterialized",
		);

		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 5, end: 10 },
			ranges: {
				mounted: { start: 5, end: 10 },
				previewVisible: { start: 5, end: 10 },
			},
		});
		ensureSpy.mockClear();

		buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 3, end: 12 },
			ranges: {
				mounted: { start: 3, end: 12 },
				previewVisible: { start: 3, end: 12 },
			},
			previousBuild: first,
		});

		expect(ensureSpy).toHaveBeenCalledTimes(2);
		expect(ensureSpy).toHaveBeenCalledWith(plan, 10, 12);
		expect(ensureSpy).toHaveBeenCalledWith(plan, 3, 5);
		ensureSpy.mockRestore();
	});

	it("falls back to full materialization when plan changes", () => {
		const plan = createLargePlan();
		const rowModel = createTwoHopViewPlanRowModel(plan);
		const ensureSpy = vi.spyOn(
			viewPlanModule,
			"ensureTwoHopMountedRangeMaterialized",
		);

		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 10 },
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 0, end: 10 },
			},
		});
		ensureSpy.mockClear();

		const newPlan = createLargePlan();
		const newRowModel = createTwoHopViewPlanRowModel(newPlan);
		buildTwoHopMountedRows({
			rowModel: newRowModel,
			rowRange: { start: 0, end: 10 },
			ranges: {
				mounted: { start: 0, end: 10 },
				previewVisible: { start: 0, end: 10 },
			},
			previousBuild: first,
		});

		expect(ensureSpy).toHaveBeenCalledTimes(1);
		expect(ensureSpy).toHaveBeenCalledWith(newPlan, { start: 0, end: 10 });
		ensureSpy.mockRestore();
	});
});
