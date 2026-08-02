import { describe, expect, it, vi } from "vitest";
import {
	compileFixedGridLayout,
	createTwoHopResolvedCellBuffer,
	createTwoHopResolvedRowBuffer,
	resolveTwoHopCell,
	resolveTwoHopCellInRowInto,
	resolveTwoHopRowInto,
	resolveTwoHopRowFromScrollOffset,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleRows,
	resolveTwoHopVisibleRowsInto,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	createTwoHopDocument,
	createTwoHopDocumentProjection,
} from "features/two-hop/ui/twoHopDocument";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createSectionDataRevision } from "features/two-hop/ui/twoHopRevisions";

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
): TwoHopVirtualSectionDescriptor {
	return {
		sourceRevision: createSectionDataRevision(1),
		section: {
			kind: "new-links-section",
			rawSectionId: sectionId,
			sectionId,
			sectionKey: sectionId,
			title: sectionId,
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

describe("TwoHopDocument fixed-grid geometry", () => {
	it("projects dense item counts without materializing items", () => {
		const items = Array.from({ length: 10 }, (_, index) =>
			createItem(String(index)),
		);
		const descriptor = createSection("first", items);
		const getItems = vi.spyOn(descriptor, "getItems");
		const getItem = vi.spyOn(descriptor, "getItem");
		const initialDocument = createTwoHopDocument({
			sections: [descriptor],
			visibleCounts: { first: 2 },
			initialVisibleCount: 2,
		});

		expect(getItems).not.toHaveBeenCalled();
		expect(getItem).not.toHaveBeenCalled();
		expect(initialDocument.sections[0].visibleItemCount).toBe(2);
		expect("visibleItems" in initialDocument.sections[0]).toBe(false);
		expect("visibleItemTitles" in initialDocument.sections[0]).toBe(false);
		expect("visibleItemLogicalKeys" in initialDocument.sections[0]).toBe(false);

		getItem.mockClear();
		const expandedDocument = createTwoHopDocument({
			sections: [descriptor],
			visibleCounts: { first: 5 },
			initialVisibleCount: 2,
			previousDocument: initialDocument,
		});

		expect(getItems).not.toHaveBeenCalled();
		expect(getItem).not.toHaveBeenCalled();
		expect(expandedDocument.sections[0].visibleItemCount).toBe(5);
		expect(expandedDocument.sections[0].getItem(4)).toBe(items[4]);
		expect(getItem.mock.calls.map(([index]) => index)).toEqual([4]);
	});

	it("reuses section projections by explicit source revision", () => {
		const descriptor = createSection("first", [createItem("a")]);
		const initialDocument = createTwoHopDocument({
			sections: [descriptor],
			visibleCounts: {},
			initialVisibleCount: 10,
		});
		const equivalentDescriptor = { ...descriptor };
		const equivalentDocument = createTwoHopDocument({
			sections: [equivalentDescriptor],
			visibleCounts: {},
			initialVisibleCount: 10,
			previousDocument: initialDocument,
		});
		const changedDocument = createTwoHopDocument({
			sections: [
				{
					...descriptor,
					sourceRevision: createSectionDataRevision(2),
				},
			],
			visibleCounts: {},
			initialVisibleCount: 10,
			previousDocument: equivalentDocument,
		});

		expect(equivalentDocument.sections[0]).toBe(initialDocument.sections[0]);
		expect(changedDocument.sections[0]).not.toBe(initialDocument.sections[0]);
		expect(equivalentDocument.revision).not.toBe(initialDocument.revision);
	});

	it("publishes a document revision only for semantic section changes", () => {
		const descriptor = createSection("first", [createItem("a")]);
		const projection = createTwoHopDocumentProjection({
			sections: [descriptor],
			initialVisibleCount: 10,
		});
		const initialDocument = projection.getDocument();

		expect(
			projection.setInput({
				sections: [{ ...descriptor }],
				paginationScope: "",
				initialVisibleCount: 10,
				loadMoreIncrement: undefined,
			}),
		).toBe(initialDocument);

		const changedDocument = projection.setInput({
			sections: [
				{
					...descriptor,
					sourceRevision: createSectionDataRevision(2),
				},
			],
			paginationScope: "",
			initialVisibleCount: 10,
			loadMoreIncrement: undefined,
		});
		expect(changedDocument).not.toBe(initialDocument);
		expect(changedDocument.revision).not.toBe(initialDocument.revision);
	});

	it("resets pagination when the search scope changes", () => {
		const descriptor = createSection("first", [
			createItem("a"),
			createItem("b"),
			createItem("c"),
		]);
		const projection = createTwoHopDocumentProjection({
			sections: [descriptor],
			initialVisibleCount: 1,
			loadMoreIncrement: 1,
		});

		expect(projection.getDocument().sections[0].visibleItemCount).toBe(1);
		expect(projection.loadMore("first")?.sections[0].visibleItemCount).toBe(2);

		const searched = projection.setInput({
			sections: [descriptor],
			paginationScope: "query",
			initialVisibleCount: 1,
			loadMoreIncrement: 1,
		});
		expect(searched.sections[0].visibleItemCount).toBe(1);
		expect(descriptor.paginationKey).toBeUndefined();
	});

	it("applies changed pagination options and restores the expanded limit", () => {
		const descriptor = createSection(
			"first",
			Array.from({ length: 20 }, (_, index) => createItem(String(index))),
		);
		const expandedLimits = new Map<string, number>();
		const applicationStore = {
			getSectionExpandedLimit: (sectionId: string) =>
				expandedLimits.get(sectionId),
			setSectionExpandedLimit: (sectionId: string, limit: number) => {
				expandedLimits.set(sectionId, limit);
			},
		};
		const projection = createTwoHopDocumentProjection({
			sections: [descriptor],
			applicationStore,
			initialVisibleCount: 2,
			loadMoreIncrement: 2,
		});

		expect(projection.getDocument().sections[0].visibleItemCount).toBe(2);

		const reconfigured = projection.setInput({
			sections: [descriptor],
			paginationScope: "",
			initialVisibleCount: 3,
			loadMoreIncrement: 4,
		});
		expect(reconfigured.sections[0].visibleItemCount).toBe(3);
		expect(projection.loadMore("first")?.sections[0].visibleItemCount).toBe(7);
		expect(expandedLimits.get("first")).toBe(7);

		const restored = projection.setInput({
			sections: [descriptor],
			paginationScope: "",
			initialVisibleCount: 1,
			loadMoreIncrement: 5,
		});
		expect(restored.sections[0].visibleItemCount).toBe(7);
		expect(projection.loadMore("first")?.sections[0].visibleItemCount).toBe(12);
	});

	it("resolves header, dense items, and load-more without compiled cells", () => {
		const items = Array.from({ length: 6 }, (_, index) =>
			createItem(String(index)),
		);
		const document = createTwoHopDocument({
			sections: [createSection("first", items)],
			visibleCounts: { first: 4 },
			initialVisibleCount: 2,
		});
		const geometry = compileFixedGridLayout(document, layout);

		expect(document.sections[0].visibleItemCount).toBe(4);
		expect(geometry.rowCount).toBe(3);
		expect(resolveTwoHopCell(document, geometry, 0, 0)?.kind).toBe("header");
		expect(resolveTwoHopCell(document, geometry, 0, 1)).toMatchObject({
			kind: "item",
			itemIndex: 0,
		});
		expect(resolveTwoHopCell(document, geometry, 1, 0)).toMatchObject({
			kind: "item",
			itemIndex: 1,
		});
		expect(resolveTwoHopCell(document, geometry, 2, 0)).toMatchObject({
			kind: "item",
			itemIndex: 3,
		});
		expect(resolveTwoHopCell(document, geometry, 2, 1)?.kind).toBe("load-more");
	});

	it("uses section prefixes to resolve row positions and viewport ranges", () => {
		const document = createTwoHopDocument({
			sections: [
				createSection("first", [createItem("a"), createItem("b")]),
				createSection("second", [createItem("c")]),
			],
			visibleCounts: {},
			initialVisibleCount: 10,
		});
		const geometry = compileFixedGridLayout(document, layout);

		expect(geometry.firstRowBySection).toEqual(new Uint32Array([0, 2]));
		expect(geometry.topBySection).toEqual(new Float64Array([0, 230]));
		expect(resolveTwoHopRowTop(geometry, 2)).toBe(230);
		expect(resolveTwoHopVisibleRows(geometry, 225, 120)).toEqual({
			start: 2,
			end: 3,
		});
		const reusableRange = { start: 0, end: 0 };
		resolveTwoHopVisibleRowsInto(reusableRange, geometry, 225, 120);
		expect(reusableRange).toEqual({ start: 2, end: 3 });
		expect(resolveTwoHopCell(document, geometry, 2, 0)).toMatchObject({
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
		expect(
			resolveTwoHopCellInRowInto(document, geometry, row, 1, cell),
		).toMatchObject({
			kind: "item",
			sectionIndex: 1,
			itemIndex: 0,
		});
	});

	it("resolves an anchor row directly from the local scroll offset", () => {
		const document = createTwoHopDocument({
			sections: [
				createSection("first", [createItem("a"), createItem("b")]),
				createSection("second", [createItem("c")]),
			],
			visibleCounts: {},
			initialVisibleCount: 10,
		});
		const geometry = compileFixedGridLayout(document, layout);

		expect(resolveTwoHopRowFromScrollOffset(geometry, 0)).toBe(0);
		expect(resolveTwoHopRowFromScrollOffset(geometry, 100)).toBe(1);
		expect(resolveTwoHopRowFromScrollOffset(geometry, 225)).toBe(2);
		expect(
			resolveTwoHopRowFromScrollOffset(geometry, geometry.totalHeight),
		).toBeNull();
	});

	it.each([
		{ scrollTop: 10, expected: { start: 0, end: 1 } },
		{ scrollTop: 10.1, expected: { start: 0, end: 2 } },
		{ scrollTop: 10.5, expected: { start: 0, end: 2 } },
		{ scrollTop: 11, expected: { start: 0, end: 2 } },
	])(
		"resolves fractional viewport edge at scrollTop=$scrollTop",
		({ scrollTop, expected }) => {
			const document = createTwoHopDocument({
				sections: [createSection("first", [createItem("a"), createItem("b")])],
				visibleCounts: {},
				initialVisibleCount: 10,
			});
			const geometry = compileFixedGridLayout(document, {
				...layout,
				columns: 1,
				sectionMarginBottom: 0,
			});

			expect(resolveTwoHopVisibleRows(geometry, scrollTop, 100)).toEqual(
				expected,
			);
		},
	);

	it("uses half-open visibility with fractional row height and gap", () => {
		const document = createTwoHopDocument({
			sections: [createSection("first", [createItem("a"), createItem("b")])],
			visibleCounts: {},
			initialVisibleCount: 10,
		});
		const geometry = compileFixedGridLayout(document, {
			...layout,
			columns: 1,
			rowHeight: 100.25,
			gap: 10.5,
			sectionMarginBottom: 0,
		});

		expect(resolveTwoHopVisibleRows(geometry, 10.75, 100)).toEqual({
			start: 0,
			end: 1,
		});
		expect(resolveTwoHopVisibleRows(geometry, 10.76, 100)).toEqual({
			start: 0,
			end: 2,
		});
		expect(resolveTwoHopVisibleRows(geometry, 100.25, 10.5)).toEqual({
			start: 1,
			end: 1,
		});
		expect(resolveTwoHopVisibleRows(geometry, 100.25, 10.51)).toEqual({
			start: 1,
			end: 2,
		});
	});
});
