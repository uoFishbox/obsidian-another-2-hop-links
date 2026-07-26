import { describe, expect, it, vi } from "vitest";
import {
	compileFixedGridLayout,
	createTwoHopResolvedCellBuffer,
	createTwoHopResolvedRowBuffer,
	resolveTwoHopCell,
	resolveTwoHopCellInRowInto,
	resolveTwoHopRowInto,
	resolveTwoHopRowTop,
	resolveTwoHopVisibleRows,
	resolveTwoHopVisibleRowsInto,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import {
	createTwoHopDocument,
	createTwoHopDocumentProjection,
} from "features/two-hop/ui/twoHopDocument";
import { createTwoHopVirtualRowModel } from "features/two-hop/ui/twoHopVirtualRowModel";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createLayoutPublication,
	createSectionDataRevision,
} from "features/two-hop/ui/twoHopRevisions";

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
		});
		expect(searched.sections[0].visibleItemCount).toBe(1);
		expect(descriptor.paginationKey).toBeUndefined();
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
			start: 1,
			end: 3,
		});
		const reusableRange = { start: 0, end: 0 };
		resolveTwoHopVisibleRowsInto(reusableRange, geometry, 225, 120);
		expect(reusableRange).toEqual({ start: 1, end: 3 });
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

	it("resolves keyboard navigation from row-model geometry", () => {
		const document = createTwoHopDocument({
			sections: [
				createSection("first", [
					createItem("a"),
					createItem("b"),
					createItem("c"),
				]),
			],
			visibleCounts: {},
			initialVisibleCount: 10,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const expectedDown = rowModel.getRow(1)?.getCell(1);
		const expectedRight = rowModel.getRow(1)?.getCell(0);

		expect(
			rowModel.resolveNavigationTarget?.("current", "down", {
				rowIndex: 0,
				columnIndex: 1,
			}),
		).toEqual({ key: expectedDown?.key, rowTop: 110 });
		expect(
			rowModel.resolveNavigationTarget?.("current", "right", {
				rowIndex: 0,
				columnIndex: 1,
			}),
		).toEqual({ key: expectedRight?.key, rowTop: 110 });
	});

	it("keeps the mounted rows resident while they cover the viewport", () => {
		const items = Array.from({ length: 30 }, (_, index) =>
			createItem(String(index)),
		);
		const document = createTwoHopDocument({
			sections: [createSection("first", items)],
			visibleCounts: {},
			initialVisibleCount: items.length,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const mounted = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(mounted, {
			scrollTop: 220,
			viewportHeight: 100,
			overscanPx: 110,
		});
		const coverageBand = { min: Number.NaN, max: Number.NaN };

		rowModel.findMountedCoverageScrollTopBandInto?.(coverageBand, {
			viewportHeight: 100,
			mounted,
			requiredOverscanPx: 0,
		});

		const requiredBeforeBand = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(requiredBeforeBand, {
			scrollTop: coverageBand.min - 1,
			viewportHeight: 100,
			overscanPx: 0,
		});
		const requiredInsideBand = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(requiredInsideBand, {
			scrollTop: coverageBand.max - 1,
			viewportHeight: 100,
			overscanPx: 0,
		});
		const requiredAtBandEnd = { start: 0, end: 0 };
		rowModel.findVisibleRangeInto(requiredAtBandEnd, {
			scrollTop: coverageBand.max,
			viewportHeight: 100,
			overscanPx: 0,
		});

		expect(requiredBeforeBand.start).toBeLessThan(mounted.start);
		expect(requiredInsideBand.start).toBeGreaterThanOrEqual(mounted.start);
		expect(requiredInsideBand.end).toBeLessThanOrEqual(mounted.end);
		expect(requiredAtBandEnd.end).toBeGreaterThan(mounted.end);
	});
});
