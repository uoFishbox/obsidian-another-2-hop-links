import { describe, expect, it } from "vitest";
import { createTwoHopRowModel, type TwoHopRowModel } from "../rowModel";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";

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

function resolveVisibleRange(
	model: TwoHopRowModel,
	params: { scrollTop: number; viewportHeight: number; overscanPx: number },
) {
	const range = { start: 0, end: 0 };
	model.findVisibleRangeInto(range, params);
	return range;
}

describe("TwoHopRowModel", () => {
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
	});

	it("reuses the resolved section while materializing a row", () => {
		const source = [createSection("first", 4)];
		let sectionReads = 0;
		const sections = new Proxy(source, {
			get(target, property, receiver) {
				if (property === "0") sectionReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		const model = createModel(sections);
		sectionReads = 0;

		const row = model.getRow(1);
		expect(row?.getCell(0)?.kind).toBe("item");
		expect(row?.getCell(1)?.kind).toBe("item");
		expect(sectionReads).toBe(1);
	});

	it("resolves half-open visible ranges across section margins", () => {
		const model = createModel([
			createSection("first", 2),
			createSection("second", 1),
		]);

		expect(
			resolveVisibleRange(model, {
				scrollTop: 225,
				viewportHeight: 120,
				overscanPx: 0,
			}),
		).toEqual({ start: 2, end: 3 });
		expect(
			resolveVisibleRange(model, {
				scrollTop: 100,
				viewportHeight: 10,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 1 });
	});

	it("derives section tops when the section margin differs from the row gap", () => {
		const model = createTwoHopRowModel({
			sections: [createSection("first", 2), createSection("second", 1)],
			layout: { ...layout, sectionMarginBottom: 30 },
		});

		expect(model.getRow(2)?.top).toBe(240);
		expect(model.totalHeight).toBe(370);
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
			resolveVisibleRange(model, {
				scrollTop: 100.25,
				viewportHeight: 10.5,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 1 });
		expect(
			resolveVisibleRange(model, {
				scrollTop: 100.25,
				viewportHeight: 10.51,
				overscanPx: 0,
			}),
		).toEqual({ start: 1, end: 2 });
	});

	it("writes the exact mounted coverage band", () => {
		const model = createModel([
			createSection("first", 2),
			createSection("second", 1),
		]);
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
	it("skips non-focusable section headers during sequential focus navigation", () => {
		const first = createSection("first", 1);
		const second = createSection("second", 1);
		const model = createModel([first, second]);
		const firstItemPosition = model.resolveCellPosition("item:first:first-0");
		const secondItemPosition = model.resolveCellPosition("item:second:second-0");
		expect(firstItemPosition).toBeTruthy();
		expect(secondItemPosition).toBeTruthy();
		if (!firstItemPosition || !secondItemPosition) return;

		expect(
			model.resolveSequentialNavigationTarget?.(
				"item:first:first-0",
				"forward",
				firstItemPosition,
			),
		).toEqual({
			key: "item:second:second-0",
			rowTop: model.getRow(secondItemPosition.rowIndex)?.top,
			...secondItemPosition,
		});
		expect(
			model.resolveSequentialNavigationTarget?.(
				"item:second:second-0",
				"backward",
				secondItemPosition,
			),
		).toEqual({
			key: "item:first:first-0",
			rowTop: model.getRow(firstItemPosition.rowIndex)?.top,
			...firstItemPosition,
		});
	});
	it("wraps to the left column of the next row when navigating right past the last column", () => {
		const section = createSection("section", 4);
		const model = createModel([section]);
		const item0Position = model.resolveCellPosition("item:section:section-0");
		const item1Position = model.resolveCellPosition("item:section:section-1");
		const item2Position = model.resolveCellPosition("item:section:section-2");
		const item3Position = model.resolveCellPosition("item:section:section-3");
		expect(item0Position).toEqual({ rowIndex: 0, columnIndex: 1 });
		expect(item1Position).toEqual({ rowIndex: 1, columnIndex: 0 });
		expect(item2Position).toEqual({ rowIndex: 1, columnIndex: 1 });
		expect(item3Position).toEqual({ rowIndex: 2, columnIndex: 0 });

		expect(
			model.resolveNavigationTarget?.(
				"item:section:section-0",
				"right",
				item0Position!,
			),
		).toEqual({
			key: "item:section:section-1",
			rowTop: model.getRow(1)?.top,
		});

		expect(
			model.resolveNavigationTarget?.(
				"item:section:section-2",
				"right",
				item2Position!,
			),
		).toEqual({
			key: "item:section:section-3",
			rowTop: model.getRow(2)?.top,
		});

		expect(
			model.resolveNavigationTarget?.(
				"item:section:section-3",
				"right",
				item3Position!,
			),
		).toBeNull();
	});
	it("wraps to the right column of the previous row when navigating left past the first column", () => {
		const section = createSection("section", 4);
		const model = createModel([section]);
		const item0Position = model.resolveCellPosition("item:section:section-0");
		const item1Position = model.resolveCellPosition("item:section:section-1");
		const item2Position = model.resolveCellPosition("item:section:section-2");
		const item3Position = model.resolveCellPosition("item:section:section-3");
		expect(item0Position).toEqual({ rowIndex: 0, columnIndex: 1 });
		expect(item1Position).toEqual({ rowIndex: 1, columnIndex: 0 });
		expect(item2Position).toEqual({ rowIndex: 1, columnIndex: 1 });
		expect(item3Position).toEqual({ rowIndex: 2, columnIndex: 0 });

		expect(
			model.resolveNavigationTarget?.(
				"item:section:section-3",
				"left",
				item3Position!,
			),
		).toEqual({
			key: "item:section:section-2",
			rowTop: model.getRow(1)?.top,
		});

		expect(
			model.resolveNavigationTarget?.(
				"item:section:section-1",
				"left",
				item1Position!,
			),
		).toEqual({
			key: "item:section:section-0",
			rowTop: model.getRow(0)?.top,
		});

		expect(
			model.resolveNavigationTarget?.(
				"item:section:section-0",
				"left",
				item0Position!,
			),
		).toBeNull();
	});
});
