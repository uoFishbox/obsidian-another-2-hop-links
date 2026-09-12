import { describe, expect, it } from "vitest";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";
import { createTwoHopRowModel } from "../rowModel";

function createItem(key: string): TwoHopItemModel {
	return {
		item: { type: "newLink" } as TwoHopItemModel["item"],
		searchKey: key,
		key,
	};
}

const section = createTwoHopSectionModel({
	id: "section",
	kind: "new-links-section",
	title: "Section",
	items: [createItem("alpha"), createItem("beta:gamma")],
	totalCount: 4,
});

function createModel() {
	return createTwoHopRowModel({
		sections: [section],
		layout: {
			containerWidth: 220,
			columns: 2,
			cellWidth: 100,
			rowHeight: 100,
			gap: 10,
			sectionMarginBottom: 10,
		},
	});
}

describe("two-hop logical cell keys", () => {
	it("keeps the stable key format on materialized cells", () => {
		const model = createModel();
		expect(model.getRow(0)?.getCell(0)?.logicalKey).toBe("header:section");
		expect(model.getRow(0)?.getCell(1)?.logicalKey).toBe("item:section:alpha");
		expect(model.getRow(1)?.getCell(1)?.logicalKey).toBe("load-more:section");
	});

	it("resolves item keys containing separators without a parser layer", () => {
		const model = createModel();
		expect(model.resolveCellPosition("item:section:beta:gamma")).toEqual({
			rowIndex: 1,
			columnIndex: 0,
		});
	});

	it("rejects keys owned by another section", () => {
		const model = createModel();
		expect(model.resolveCellPosition("item:other:alpha")).toBeNull();
		expect(model.resolveCellPosition("load-more:other")).toBeNull();
	});
});
