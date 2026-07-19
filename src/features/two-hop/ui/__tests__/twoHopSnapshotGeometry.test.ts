import { describe, expect, it, vi } from "vitest";
import {
	createTwoHopGeometry,
	createTwoHopResolvedCellBuffer,
	createTwoHopResolvedRowBuffer,
	resolveTwoHopCell,
	resolveTwoHopCellInRowInto,
	resolveTwoHopRowInto,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleRows,
	resolveTwoHopVisibleRowsInto,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import { createTwoHopSnapshot } from "features/two-hop/ui/viewport/twoHopSnapshot";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";

const createItem = (key: string): TwoHopVirtualListItem => ({
	kind: "new-link",
	item: { type: "newLink" } as TwoHopVirtualListItem["item"],
	searchKey: key,
	virtualKey: key,
});

const resolveItemTitle = (item: TwoHopVirtualListItem): string => item.virtualKey;

function createSection(
	sectionId: string,
	items: readonly TwoHopVirtualListItem[],
	loadedCount = items.length,
): TwoHopVirtualSectionDescriptor {
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
		getItem: (index) => items[index],
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
	it("materializes only the visible range and extends it incrementally", () => {
		const items = Array.from({ length: 10 }, (_, index) =>
			createItem(String(index)),
		);
		const descriptor = createSection("first", items);
		const getItems = vi.spyOn(descriptor, "getItems");
		const getItem = vi.spyOn(descriptor, "getItem");
		const resolveVisibleItemTitle = vi.fn(
			(item: TwoHopVirtualListItem) => `Title ${item.virtualKey}`,
		);
		const initialSnapshot = createTwoHopSnapshot({
			sections: [descriptor],
			visibleCounts: { first: 2 },
			initialVisibleCount: 2,
			resolveItemTitle: resolveVisibleItemTitle,
		});

		expect(getItems).not.toHaveBeenCalled();
		expect(getItem.mock.calls.map(([index]) => index)).toEqual([0, 1]);
		expect(initialSnapshot.sections[0].visibleItems).toEqual(items.slice(0, 2));
		expect(initialSnapshot.sections[0].visibleItemTitles).toEqual([
			"Title 0",
			"Title 1",
		]);

		getItem.mockClear();
		const expandedSnapshot = createTwoHopSnapshot({
			sections: [descriptor],
			visibleCounts: { first: 5 },
			initialVisibleCount: 2,
			resolveItemTitle: resolveVisibleItemTitle,
			previousSnapshot: initialSnapshot,
		});

		expect(getItems).not.toHaveBeenCalled();
		expect(getItem.mock.calls.map(([index]) => index)).toEqual([2, 3, 4]);
		expect(expandedSnapshot.sections[0].visibleItems).toEqual(items.slice(0, 5));
		expect(expandedSnapshot.sections[0].visibleItemTitles).toEqual([
			"Title 0",
			"Title 1",
			"Title 2",
			"Title 3",
			"Title 4",
		]);
		expect(
			resolveVisibleItemTitle.mock.calls.map(([item]) => item.virtualKey),
		).toEqual(["0", "1", "2", "3", "4"]);
		expect(expandedSnapshot.sections[0].visibleItemSourceIndexes).toEqual(
			new Uint32Array([0, 1, 2, 3, 4]),
		);
	});

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
			resolveItemTitle,
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
			shellTitle: "a",
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
			resolveItemTitle,
		});
		const geometry = createTwoHopGeometry(snapshot, layout);

		expect(geometry.firstRowBySection).toEqual(new Uint32Array([0, 2]));
		expect(geometry.topBySection).toEqual(new Float64Array([0, 230]));
		expect(resolveTwoHopRowTop(geometry, 2)).toBe(230);
		expect(resolveTwoHopVisibleRows(geometry, 225, 120)).toEqual({
			start: 1,
			end: 3,
		});
		const reusableRange = { start: 0, end: 0 };
		resolveTwoHopVisibleRowsInto(reusableRange, geometry, 225, 120);
		expect(reusableRange).toEqual({ start: 1, end: 3 });
		expect(resolveTwoHopCell(snapshot, geometry, 2, 0)).toMatchObject({
			kind: "header",
			sectionIndex: 1,
		});
		const row = createTwoHopResolvedRowBuffer();
		const cell = createTwoHopResolvedCellBuffer();
		expect(resolveTwoHopRowInto(geometry, 2, row)).toBe(true);
		expect(row).toEqual({
			sectionIndex: 1,
			rowIndex: 2,
			rowInSection: 0,
			top: 230,
		});
		expect(resolveTwoHopCellInRowInto(snapshot, geometry, row, 1, cell)).toMatchObject(
			{
				kind: "item",
				sectionIndex: 1,
				itemIndex: 0,
			},
		);
	});
});
