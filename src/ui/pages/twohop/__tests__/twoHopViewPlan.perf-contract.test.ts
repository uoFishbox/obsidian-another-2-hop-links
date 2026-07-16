import { describe, expect, it, vi } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import { compileTwoHopViewPlan, createTwoHopViewPlanRowModel } from "../twoHopViewPlan";
import { createTwoHopScalarScrollKernel } from "../twoHopScalarScrollKernel.svelte";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";

const LARGE_CARD_COUNT = 10_000;
const SCROLL_FRAMES = 300;
const COLUMNS = 3;
const MOUNTED_ROWS = 9;
const POOL_CAPACITY = Math.ceil(MOUNTED_ROWS * 1.25) + 2;

const layout = {
	containerWidth: 640,
	columns: COLUMNS,
	cellWidth: 200,
	rowHeight: 120,
	gap: 12,
	sectionMarginBottom: 20,
};

const createItem = (key: string): TwoHopVirtualListItem => ({
	kind: "new-link",
	item: { type: "link" } as unknown as TwoHopVirtualListItem["item"],
	searchKey: key,
	virtualKey: key,
});

const createDescriptor = (
	itemCount: number,
	sectionId = "new-links",
	getItems = vi.fn(() =>
		Array.from({ length: itemCount }, (_, index) =>
			createItem(`${sectionId}-item-${index}`),
		),
	),
): SectionRenderDescriptor<TwoHopVirtualListItem, TwoHopVirtualListSection> => {
	const items = getItems();
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
		totalCount: itemCount,
		loadedCount: itemCount,
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
) =>
	compileTwoHopViewPlan({
		sections,
		sectionVisibleCounts: Object.fromEntries(
			sections.map((section) => [section.sectionId, section.loadedCount]),
		),
		layout,
		resolveInitialSectionVisibleCount: (section) => section.loadedCount,
		clampVisibleCount: (section, count) => Math.min(section.loadedCount, count),
	});

describe("TwoHop view-plan performance contracts", () => {
	it("compiles direct typed row geometry without heap row objects", () => {
		const sections = Array.from({ length: 32 }, (_, index) =>
			createDescriptor(1_000, `section-${index}`),
		);
		const plan = compilePlan(sections);

		expect("rowTable" in plan).toBe(false);
		expect("cellStore" in plan).toBe(false);
		expect(plan.cells).toHaveLength(plan.cellCount);
		expect(plan.rowCount).toBeGreaterThan(plan.sections.length * 300);
		expect(plan.sectionTable.topBySection).toHaveLength(sections.length);
		expect(plan.sectionTable.firstRowIndexBySection).toHaveLength(sections.length);
		expect(plan.sectionTable.rowCountBySection).toHaveLength(sections.length);
		expect(plan.rowSectionIndex).toHaveLength(plan.rowCount);
		expect(plan.rowFirstCellIndex).toHaveLength(plan.rowCount);
		expect(plan.rowCellCount).toHaveLength(plan.rowCount);
		expect(plan.rowTop).toHaveLength(plan.rowCount);
	});

	it("prepares section items once and reads cells without descriptor access during scroll", () => {
		const getItems = vi.fn(() =>
			Array.from({ length: LARGE_CARD_COUNT }, (_, index) =>
				createItem(`item-${index}`),
			),
		);
		const rowModel = createTwoHopViewPlanRowModel(
			compilePlan([createDescriptor(LARGE_CARD_COUNT, "new-links", getItems)]),
		);
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		getItems.mockClear();

		for (let frame = 0; frame <= SCROLL_FRAMES; frame += 1) {
			kernel.applyMeasurement({
				rowModel,
				scrollTop: 0,
				viewportHeight: 600,
				sectionTop: 0,
				isStableMeasurement: true,
				isScrollActive: true,
				hasStableVisibleRange: true,
				precomputedRanges: {
					mounted: { start: frame, end: frame + MOUNTED_ROWS },
					previewVisible: { start: frame + 2, end: frame + 7 },
				},
				visibilityPolicy: {
					bootstrapRows: 3,
					mountedOverscanPx: 264,
				},
			});
		}

		expect(getItems).not.toHaveBeenCalled();
		expect(kernel.mountedRows).toHaveLength(POOL_CAPACITY);
		expect(kernel.fixedRowSlotPool.controllers).toHaveLength(POOL_CAPACITY);
	});

	it("keeps cell render slot keys bounded across 300 scroll frames", () => {
		const rowModel = createTwoHopViewPlanRowModel(
			compilePlan([createDescriptor(LARGE_CARD_COUNT)]),
		);
		const kernel = createTwoHopScalarScrollKernel({
			initialRowModel: rowModel,
			onStableVisibleRange() {},
		});
		let maxCellSlotKey = 0;

		for (let frame = 0; frame <= SCROLL_FRAMES; frame += 1) {
			kernel.applyMeasurement({
				rowModel,
				scrollTop: 0,
				viewportHeight: 600,
				sectionTop: 0,
				isStableMeasurement: true,
				isScrollActive: true,
				hasStableVisibleRange: true,
				precomputedRanges: {
					mounted: { start: frame, end: frame + MOUNTED_ROWS },
					previewVisible: { start: frame + 2, end: frame + 7 },
				},
				visibilityPolicy: {
					bootstrapRows: 3,
					mountedOverscanPx: 264,
				},
			});
			for (const row of kernel.mountedRows) {
				for (const cell of row.cells) {
					maxCellSlotKey = Math.max(maxCellSlotKey, cell.cellSlotKey ?? 0);
				}
			}
		}

		expect(maxCellSlotKey).toBeLessThan(POOL_CAPACITY * COLUMNS);
	});
});
