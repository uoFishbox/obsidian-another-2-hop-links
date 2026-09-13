import { describe, expect, it, vi } from "vitest";
import { createTwoHopRowModel } from "../rowModel";
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

function createItem(sectionId: string, index: number): TwoHopItemModel {
	return {
		item: { type: "newLink" } as TwoHopItemModel["item"],
		searchKey: `${sectionId}-${index}`,
		key: `${sectionId}-${index}`,
	};
}

function createSection(
	id: string,
	count: number,
	headerProps?: TwoHopSectionModel["header"]["props"],
): TwoHopSectionModel {
	return createTwoHopSectionModel({
		id,
		kind: "new-links-section",
		title: id,
		headerProps,
		items: Array.from({ length: count }, (_, index) => createItem(id, index)),
		totalCount: count,
	});
}

function createModel(
	sections: readonly TwoHopSectionModel[],
	columns = layout.columns,
) {
	return createTwoHopRowModel({
		sections,
		layout: { ...layout, columns },
	});
}

function requirePosition(model: ReturnType<typeof createTwoHopRowModel>, key: string) {
	const position = model.resolveCellPosition(key);
	if (!position) throw new Error(`Missing cell position for ${key}`);
	return position;
}

describe("two-hop navigation policy", () => {
	it("skips non-focusable headers when navigating sequentially", () => {
		const model = createModel([
			createSection("first", 2),
			createSection("second", 2),
		]);
		const lastOfFirst = "item:first:first-1";
		const firstOfSecond = "item:second:second-0";
		const expectedPosition = requirePosition(model, firstOfSecond);

		expect(
			model.resolveSequentialNavigationTarget?.(
				lastOfFirst,
				"forward",
				requirePosition(model, lastOfFirst),
			),
		).toEqual({
			key: firstOfSecond,
			rowTop: model.getRow(expectedPosition.rowIndex)?.top,
			...expectedPosition,
		});
	});

	it("treats a clickable header as sequentially focusable", () => {
		const model = createModel([
			createSection("first", 2),
			createSection("second", 2, { onClick: vi.fn() }),
		]);
		const lastOfFirst = "item:first:first-1";
		const headerOfSecond = "header:second";
		const headerPosition = requirePosition(model, headerOfSecond);

		expect(
			model.resolveSequentialNavigationTarget?.(
				lastOfFirst,
				"forward",
				requirePosition(model, lastOfFirst),
			),
		).toEqual({
			key: headerOfSecond,
			rowTop: model.getRow(headerPosition.rowIndex)?.top,
			...headerPosition,
		});
	});

	it("wraps horizontal navigation across rows", () => {
		const model = createModel([createSection("section", 4)]);
		const item0 = "item:section:section-0";
		const item1 = "item:section:section-1";
		const item2 = "item:section:section-2";
		const item3 = "item:section:section-3";

		expect(
			model.resolveNavigationTarget?.(
				item0,
				"right",
				requirePosition(model, item0),
			),
		).toEqual({
			key: item1,
			rowTop: model.getRow(requirePosition(model, item1).rowIndex)?.top,
		});
		expect(
			model.resolveNavigationTarget?.(
				item3,
				"left",
				requirePosition(model, item3),
			),
		).toEqual({
			key: item2,
			rowTop: model.getRow(requirePosition(model, item2).rowIndex)?.top,
		});
	});

	it("keeps the nearest column when navigating vertically", () => {
		const model = createModel([createSection("section", 4)]);
		const item0 = "item:section:section-0";
		const item1 = "item:section:section-1";
		const item2 = "item:section:section-2";
		const item3 = "item:section:section-3";

		expect(
			model.resolveNavigationTarget?.(
				item0,
				"down",
				requirePosition(model, item0),
			),
		).toEqual({
			key: item2,
			rowTop: model.getRow(requirePosition(model, item2).rowIndex)?.top,
		});
		expect(
			model.resolveNavigationTarget?.(item3, "up", requirePosition(model, item3)),
		).toEqual({
			key: item1,
			rowTop: model.getRow(requirePosition(model, item1).rowIndex)?.top,
		});
		// Falls back to the nearest focusable cell when the column is empty.
		expect(
			model.resolveNavigationTarget?.(
				item2,
				"down",
				requirePosition(model, item2),
			),
		).toEqual({
			key: item3,
			rowTop: model.getRow(requirePosition(model, item3).rowIndex)?.top,
		});
	});

	it("moves focus above the grid only from its first item row", () => {
		const model = createModel([createSection("section", 3)], 1);
		const first = "item:section:section-0";
		const second = "item:section:section-1";

		expect(
			model.shouldMoveFocusAboveGrid(first, requirePosition(model, first)),
		).toBe(true);
		expect(
			model.shouldMoveFocusAboveGrid(second, requirePosition(model, second)),
		).toBe(false);
		expect(
			model.shouldMoveFocusAboveGrid("header:section", {
				rowIndex: 0,
				columnIndex: 0,
			}),
		).toBe(false);
		expect(
			model.shouldMoveFocusAboveGrid("stale", requirePosition(model, first)),
		).toBe(false);
	});
});
