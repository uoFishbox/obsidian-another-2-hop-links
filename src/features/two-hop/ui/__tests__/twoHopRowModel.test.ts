import { describe, expect, it } from "vitest";
import { createTwoHopRowModel } from "features/two-hop/ui/twoHopRowModel";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";

const layout = {
	containerWidth: 220,
	columns: 2,
	cellWidth: 100,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 10,
};

function createItem(key: string): TwoHopItemModel {
	return {
		item: { type: "newLink" } as TwoHopItemModel["item"],
		searchKey: key,
		key,
	};
}

function createSection(
	id: string,
	count: number,
	visibleCount = count,
): TwoHopSectionModel {
	return createTwoHopSectionModel({
		id,
		kind: "new-links-section",
		title: id,
		items: Array.from({ length: visibleCount }, (_, index) =>
			createItem(`${id}-${index}`),
		),
		totalCount: count,
	});
}

function createModel(sections: readonly TwoHopSectionModel[]) {
	return createTwoHopRowModel({
		sections,
		layout,
	});
}

describe("TwoHopRowModel", () => {
	it("uses sections as the sole logical content publication", () => {
		const sections = [createSection("first", 2)];
		const model = createModel(sections);
		const otherModel = createModel([createSection("second", 1)]);
		if ("kind" in model.revision || "kind" in otherModel.revision) {
			throw new Error("Expected structured virtual-list revisions");
		}

		expect(model.revision.content).toBe(sections);
		expect(model.revision.pagination).toBe(otherModel.revision.pagination);
	});

	it("compiles section prefixes including header and load-more cells", () => {
		const model = createModel([
			createSection("first", 4, 3),
			createSection("second", 1),
		]);

		expect(model.rowCount).toBe(4);
		expect(model.getRow(0)?.top).toBe(0);
		expect(model.getRow(0)?.cellCount).toBe(2);
		expect(model.getRow(3)?.top).toBe(330);
		expect(model.getRow(2)?.getCell(0)?.kind).toBe("load-more");
		expect(model.cardCounts).toEqual({
			header: 2,
			item: 4,
			loadMore: 1,
			total: 7,
		});
	});

	it("resolves half-open visible ranges across section margins", () => {
		const model = createModel([
			createSection("first", 2),
			createSection("second", 1),
		]);

		expect(
			model.findVisibleRange({
				scrollTop: 225,
				viewportHeight: 120,
				overscanPx: 0,
			}),
		).toEqual({ start: 2, end: 3 });
		expect(
			model.findVisibleRange({
				scrollTop: 100,
				viewportHeight: 10,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 1 });
	});

	it("preserves half-open visibility with fractional row metrics", () => {
		const section = createSection("first", 2);
		const model = createTwoHopRowModel({
			sections: [section],
			layout: {
				...layout,
				columns: 1,
				rowHeight: 100.25,
				gap: 10.5,
				sectionMarginBottom: 0,
			},
		});

		expect(
			model.findVisibleRange({
				scrollTop: 100.25,
				viewportHeight: 10.5,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 1 });
		expect(
			model.findVisibleRange({
				scrollTop: 100.25,
				viewportHeight: 10.51,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
	});

	it("writes exact stable and coverage bands", () => {
		const model = createModel([
			createSection("first", 2),
			createSection("second", 1),
		]);
		const stable = { min: 0, max: 0 };
		model.findStableMountedScrollTopBandInto(stable, {
			mounted: { start: 2, end: 3 },
			mountedOverscanPx: 0,
			viewportHeight: 120,
		});
		expect(stable).toEqual({ min: 210, max: 320 });

		const coverage = { min: 0, max: 0 };
		model.findMountedCoverageScrollTopBandInto(coverage, {
			mounted: { start: 2, end: 3 },
			viewportHeight: 120,
			requiredOverscanPx: 0,
		});
		expect(coverage).toEqual({ min: 210, max: 330 });
	});

	it("resolves navigation against rows that are not resident", () => {
		const section = createSection("section", 80);
		const model = createTwoHopRowModel({
			sections: [section],
			layout: { ...layout, columns: 1 },
		});

		expect(
			model.resolveNavigationTarget?.("item:section:section-30", "down", {
				rowIndex: 31,
				columnIndex: 0,
			}),
		).toEqual({
			key: "item:section:section-31",
			rowTop: 32 * 110,
		});
	});

	it("resolves a logical cell after a column-count change for anchoring", () => {
		const section = createSection("section", 10);
		const oneColumn = createTwoHopRowModel({
			sections: [section],
			layout: { ...layout, columns: 1 },
		});
		const twoColumns = createModel([section]);

		expect(oneColumn.resolveCellPosition("item:section:section-5")).toEqual({
			rowIndex: 6,
			columnIndex: 0,
		});
		expect(twoColumns.resolveCellPosition("item:section:section-5")).toEqual({
			rowIndex: 3,
			columnIndex: 0,
		});
	});
});
