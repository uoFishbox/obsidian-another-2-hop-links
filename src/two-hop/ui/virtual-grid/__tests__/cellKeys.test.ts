import { describe, expect, it } from "vitest";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
} from "two-hop/ui/twoHopSectionModel";
import { parseTwoHopCellKey, twoHopCellKey } from "../cellKeys";

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

describe("twoHopCellKey", () => {
	it("builds the stable logical key format", () => {
		expect(twoHopCellKey.header(section)).toBe("header:section");
		expect(twoHopCellKey.item("section", "alpha")).toBe("item:section:alpha");
		expect(twoHopCellKey.loadMore("section")).toBe("load-more:section");
	});

	it("parses every cell kind against its own section", () => {
		expect(parseTwoHopCellKey(section, "header:section")).toEqual({
			kind: "header",
		});
		expect(parseTwoHopCellKey(section, "item:section:alpha")).toEqual({
			kind: "item",
			itemKey: "alpha",
		});
		expect(parseTwoHopCellKey(section, "load-more:section")).toEqual({
			kind: "load-more",
		});
	});

	it("keeps item keys that contain the separator intact", () => {
		expect(parseTwoHopCellKey(section, "item:section:beta:gamma")).toEqual({
			kind: "item",
			itemKey: "beta:gamma",
		});
	});

	it("rejects keys that belong to another section", () => {
		expect(parseTwoHopCellKey(section, "item:other:alpha")).toBeNull();
		expect(parseTwoHopCellKey(section, "load-more:other")).toBeNull();
	});
});
