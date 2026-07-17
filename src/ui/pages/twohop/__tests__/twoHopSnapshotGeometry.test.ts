import { describe, expect, it } from "vitest";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import {
	createTwoHopGeometry,
	resolveTwoHopCell,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleRows,
} from "../twoHopGeometry";
import { createTwoHopSnapshot } from "../twoHopSnapshot";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "../twoHopVirtualListModel";

const createItem = (key: string): TwoHopVirtualListItem => ({
	kind: "new-link",
	item: { type: "newLink" } as TwoHopVirtualListItem["item"],
	searchKey: key,
	virtualKey: key,
});

function createSection(
	sectionId: string,
	items: readonly TwoHopVirtualListItem[],
	loadedCount = items.length,
): SectionRenderDescriptor<TwoHopVirtualListItem, TwoHopVirtualListSection> {
	return {
		section: {
			kind: "new-links-section",
			rawSectionId: sectionId,
			sectionId,
			sectionKey: sectionId,
			title: sectionId,
			getKey: (_item, index) => `${sectionId}:${index}`,
		},
		sectionKey: sectionId,
		title: sectionId,
		sectionId,
		totalCount: loadedCount,
		loadedCount,
		getItems: () => items,
		headerProps: {},
	};
}

const layout = {
	containerWidth: 420,
	columns: 2,
	cellWidth: 200,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

describe("twoHopSnapshot geometry", () => {
	it("resolves header, sparse items, and load-more without compiled cells", () => {
		const sparseItems: TwoHopVirtualListItem[] = [
			createItem("a"),
			undefined as unknown as TwoHopVirtualListItem,
			createItem("c"),
			createItem("d"),
		];
		const snapshot = createTwoHopSnapshot({
			sections: [createSection("first", sparseItems, 6)],
			visibleCounts: { first: 4 },
			initialVisibleCount: 2,
		});
		const geometry = createTwoHopGeometry(snapshot, layout);

		expect(snapshot.sections[0].visibleItemSourceIndexes).toEqual(
			new Uint32Array([0, 2, 3]),
		);
		expect(geometry.rowCount).toBe(3);
		expect(resolveTwoHopCell(snapshot, geometry, 0, 0)?.kind).toBe("header");
		expect(resolveTwoHopCell(snapshot, geometry, 0, 1)).toMatchObject({
			kind: "item",
			itemIndex: 0,
		});
		expect(resolveTwoHopCell(snapshot, geometry, 1, 0)).toMatchObject({
			kind: "item",
			itemIndex: 2,
		});
		expect(resolveTwoHopCell(snapshot, geometry, 2, 0)?.kind).toBe("load-more");
		expect(resolveTwoHopCell(snapshot, geometry, 2, 1)).toBeNull();
	});

	it("uses section prefixes to resolve row positions and viewport ranges", () => {
		const snapshot = createTwoHopSnapshot({
			sections: [
				createSection("first", [createItem("a"), createItem("b")]),
				createSection("second", [createItem("c")]),
			],
			visibleCounts: {},
			initialVisibleCount: 10,
		});
		const geometry = createTwoHopGeometry(snapshot, layout);

		expect(geometry.firstRowBySection).toEqual(new Uint32Array([0, 2]));
		expect(geometry.topBySection).toEqual(new Float64Array([0, 230]));
		expect(resolveTwoHopRowTop(geometry, 2)).toBe(230);
		expect(resolveTwoHopVisibleRows(geometry, 225, 120)).toEqual({
			start: 1,
			end: 3,
		});
		expect(resolveTwoHopCell(snapshot, geometry, 2, 0)).toMatchObject({
			kind: "header",
			sectionIndex: 1,
		});
	});
});
