import { describe, expect, it, vi } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";
import type { TwoHopSectionTable } from "../twoHopViewPlan";
import {
	compileTwoHopViewPlan,
	createTwoHopViewPlanRowModel,
	findTwoHopRowsByOffset,
	findTwoHopRowsByOffsetInto,
} from "../twoHopViewPlan";

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

const compilePlan = (
	sections: readonly SectionRenderDescriptor<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[],
	sectionVisibleCounts: Readonly<Record<string, number>> = {},
) =>
	compileTwoHopViewPlan({
		sections,
		sectionVisibleCounts,
		layout,
		resolveInitialSectionVisibleCount: (section) => section.loadedCount,
		clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
	});

const createSectionTable = (
	sections: readonly {
		readonly top: number;
		readonly firstRowIndex: number;
		readonly rowCount: number;
	}[],
): TwoHopSectionTable => {
	const sectionCount = sections.length;
	const topBySection = new Float64Array(sectionCount);
	const heightBySection = new Float64Array(sectionCount);
	const firstRowIndexBySection = new Uint32Array(sectionCount);
	const rowCountBySection = new Uint32Array(sectionCount);
	for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
		const section = sections[sectionIndex];
		topBySection[sectionIndex] = section.top;
		firstRowIndexBySection[sectionIndex] = section.firstRowIndex;
		rowCountBySection[sectionIndex] = section.rowCount;
	}
	return {
		sectionCount,
		topBySection,
		heightBySection,
		firstRowIndexBySection,
		rowCountBySection,
		firstCellIndexBySection: new Uint32Array(sectionCount),
		cellCountBySection: new Uint32Array(sectionCount),
		visibleCountBySection: new Uint32Array(sectionCount),
		showLoadMoreBySection: new Uint8Array(sectionCount),
	};
};

describe("compileTwoHopViewPlan", () => {
	it("compiles section geometry and prepared cells without a cell store", () => {
		const getItems = vi.fn(() => [
			createItem("a"),
			createItem("b"),
			createItem("c"),
		]);
		const descriptor = createDescriptor(getItems(), getItems);
		getItems.mockClear();

		const plan = compilePlan([descriptor], { "new-links": 3 });

		expect(getItems).toHaveBeenCalledTimes(1);
		expect(plan).not.toHaveProperty("cellStore");
		expect(
			Array.from({ length: plan.sections[0].cellCount }, (_, index) =>
				plan.sections[0].itemSource.readCell(index)?.kind,
			),
		).toEqual(["header", "item", "item", "item"]);
		expect(plan.sections[0].itemSource.readCell(1)).toMatchObject({
			key: "new-links::item:0",
			sourceKey: "new-links::a",
		});
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
	});

	it("resolves rows, navigation, and visible ranges from the prepared snapshot", () => {
		const plan = compilePlan(
			[createDescriptor([createItem("a"), createItem("b"), createItem("c")])],
			{ "new-links": 3 },
		);
		const rowModel = createTwoHopViewPlanRowModel(plan);

		expect(rowModel.getRow(1)).toMatchObject({
			top: 110,
			cellCount: 2,
		});
		expect(rowModel.getRow(1)?.getCell(1)).toMatchObject({
			kind: "item",
			sourceKey: "new-links::c",
		});
		expect(
			rowModel.findVisibleRange({
				scrollTop: 105,
				viewportHeight: 10,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
		expect(
			rowModel.resolveNavigationTarget?.("", "down", {
				rowIndex: 0,
				columnIndex: 1,
			}),
		).toEqual({
			key: "new-links::item:2",
			rowTop: 110,
		});
	});

	it("includes a prepared load-more cell when visible items are truncated", () => {
		const plan = compilePlan(
			[
				createDescriptor([
					createItem("a"),
					createItem("b"),
					createItem("c"),
				]),
			],
			{ "new-links": 1 },
		);

		expect(
			Array.from({ length: plan.sections[0].cellCount }, (_, index) =>
				plan.sections[0].itemSource.readCell(index)?.kind,
			),
		).toEqual(["header", "item", "load-more"]);
		expect(plan.sections[0].showLoadMore).toBe(true);
	});

	it("keeps section-local prepared cells independent across sections", () => {
		const plan = compilePlan([
			createDescriptor([createItem("a")], undefined, "section-a"),
			createDescriptor([createItem("b")], undefined, "section-b"),
		]);

		expect(plan.sections[0].itemSource.readCell(1)).toMatchObject({
			kind: "item",
			sourceKey: "section-a::a",
		});
		expect(plan.sections[1].itemSource.readCell(1)).toMatchObject({
			kind: "item",
			sourceKey: "section-b::b",
		});
		expect(plan.sections[1].itemSource.readCell(2)).toBeUndefined();
	});
});

describe("findTwoHopRowsByOffset", () => {
	it("calculates the row index within a section", () => {
		const sectionTable = createSectionTable([
			{ top: 0, firstRowIndex: 0, rowCount: 2 },
			{ top: 240, firstRowIndex: 2, rowCount: 3 },
		]);

		expect(
			findTwoHopRowsByOffset({
				sectionTable,
				rowHeight: 100,
				rowGap: 10,
				scrollTop: 250,
				viewportHeight: 100,
				overscanPx: 0,
			}),
		).toEqual({ start: 2, end: 3 });
	});

	it("writes into the provided row range", () => {
		const sectionTable = createSectionTable([
			{ top: 0, firstRowIndex: 0, rowCount: 4 },
		]);
		const out = { start: -1, end: -1 };

		findTwoHopRowsByOffsetInto(out, {
			sectionTable,
			rowHeight: 100,
			rowGap: 10,
			scrollTop: 105,
			viewportHeight: 10,
			overscanPx: 0,
		});

		expect(out).toEqual({ start: 1, end: 2 });
	});

	it("excludes rows that only touch the viewport boundaries", () => {
		const sectionTable = createSectionTable([
			{ top: 0, firstRowIndex: 0, rowCount: 3 },
		]);

		expect(
			findTwoHopRowsByOffset({
				sectionTable,
				rowHeight: 100,
				rowGap: 10,
				scrollTop: 100,
				viewportHeight: 10,
				overscanPx: 0,
			}),
		).toEqual({ start: 0, end: 0 });
	});
});
