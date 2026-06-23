import { describe, expect, it, vi } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type {
	TwoHopPageVirtualSection,
	TwoHopPageVirtualItem,
} from "../twohopPageVirtualModel";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	findTwoHopRowsByOffset,
	findTwoHopRowsByOffsetInto,
	hasUnmaterializedTwoHopSections,
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

const createItem = (virtualKey: string): TwoHopPageVirtualItem => ({
	kind: "new-link",
	item: { type: "link" } as unknown as TwoHopPageVirtualItem["item"],
	searchKey: virtualKey,
	virtualKey,
});

const createDescriptor = (
	items: readonly TwoHopPageVirtualItem[],
	getItems = vi.fn(() => items),
	sectionId = "new-links",
): SectionRenderDescriptor<TwoHopPageVirtualItem, TwoHopPageVirtualSection> => {
	const section = {
		kind: "new-links-section",
		rawSectionId: sectionId,
		sectionId,
		sectionKey: sectionId,
		title: "New links",
		getKey: () => "",
	} satisfies TwoHopPageVirtualSection;
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
		expect(plan.sections[0].logicalCells.map((cell) => cell?.kind)).toEqual([
			"header",
			"item",
			"item",
			"item",
		]);
		expect(plan.sections[0].logicalCells[1]).toMatchObject({
			key: "new-links::item:0",
			sourceKey: "new-links::a",
		});
		expect(plan).not.toHaveProperty("rows");
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
			key: plan.sections[0].logicalCells[3]?.key,
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

		expect(plan.sections[0].logicalCells.map((cell) => cell?.kind)).toEqual([
			"header",
			"item",
			"load-more",
		]);
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

		expect(plan.materializedSectionByIndex).toEqual([false, false]);
		expect(plan.sections.map((section) => section.logicalCells.length)).toEqual([
			2, 2,
		]);
		expect(resolveTwoHopLogicalCellInSection(plan, 1, 1)).toMatchObject({
			kind: "item",
			sourceKey: "section-b::b",
		});
		expect(plan.materializedSectionByIndex).toEqual([false, false]);
		expect(plan.sections[1].logicalCells.map((cell) => cell?.kind)).toEqual([
			undefined,
			"item",
		]);
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
		expect(batchedPlan.materializedSectionByIndex).toEqual([
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
		expect(batchedPlan.nextUnmaterializedSectionIndex).toBe(10);
		expect(batchedPlan.remainingUnmaterializedSectionCount).toBe(2);
		expect(batchedPlan.remainingUnmaterializedCellCount).toBe(4);
		expect(hasUnmaterializedTwoHopSections(batchedPlan)).toBe(true);

		expect(batchedRowModel.getRow(11)?.getCell(1)?.kind).toBe("item");
		expect(batchedPlan.materializedSectionByIndex[11]).toBe(false);
		expect(batchedPlan.nextUnmaterializedSectionIndex).toBe(10);
		expect(batchedPlan.remainingUnmaterializedSectionCount).toBe(2);
		expect(batchedPlan.remainingUnmaterializedCellCount).toBe(4);
		expect(getItemsBySection.map((getItems) => getItems.mock.calls.length)).toEqual(
			new Array<number>(12).fill(1),
		);

		expect(
			materializeNextTwoHopSectionBatch(batchedPlan, {
				maxSectionCount: 10,
			}),
		).toBe(true);
		expect(batchedPlan.materializedSectionByIndex).toEqual(
			new Array<boolean>(12).fill(true),
		);
		expect(getItemsBySection.map((getItems) => getItems.mock.calls.length)).toEqual(
			new Array<number>(12).fill(1),
		);
		expect(batchedPlan.nextUnmaterializedSectionIndex).toBe(12);
		expect(batchedPlan.remainingUnmaterializedSectionCount).toBe(0);
		expect(batchedPlan.remainingUnmaterializedCellCount).toBe(0);
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
		expect(plan.materializedSectionByIndex).toEqual([true, false, false]);
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

		expect(plan.materializedSectionByIndex).toEqual([true, false, false]);
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
		expect(plan.materializedSectionByIndex).toEqual([false, false]);
		expect(plan.materializationStateBySectionIndex[0]).toEqual({
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
		expect(plan.materializedSectionByIndex).toEqual([false, false]);
		expect(plan.materializationStateBySectionIndex[0]).toEqual({
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
		expect(mounted.cells[0].cell).toBe(plan.sections[0].logicalCells[0]);
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

	it("rebuilds same-plan mounted rows after materialization changes", () => {
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
		const mountedRevision = mounted.materializationRevision;

		expect(
			materializeNextTwoHopSectionBatch(plan, {
				maxCellCount: 3,
			}),
		).toBe(true);
		expect(plan.materializationRevision).toBeGreaterThan(mountedRevision ?? -1);

		const rebuilt = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 1 },
			ranges: {
				mounted: { start: 0, end: 1 },
				previewVisible: { start: 0, end: 1 },
			},
			previousBuild: mounted,
		});

		expect(rebuilt.rowSlices[0]).not.toBe(mounted.rowSlices[0]);
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
