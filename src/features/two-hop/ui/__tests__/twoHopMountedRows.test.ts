import { describe, expect, it, vi } from "vitest";
import { createTwoHopDocument } from "features/two-hop/ui/twoHopDocument";
import { createTwoHopVirtualRowModel } from "features/two-hop/ui/twoHopVirtualRowModel";
import { buildTwoHopMountedRows } from "features/two-hop/ui/twoHopMountedRows";
import { createTwoHopResidentRowSlotAllocator } from "features/two-hop/ui/twoHopResidentRowSlotAllocator";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";

const layout = {
	containerWidth: 420,
	columns: 2,
	cellWidth: 200,
	rowHeight: 100,
	gap: 10,
	sectionMarginBottom: 20,
};

function createSection(count: number): TwoHopVirtualSectionDescriptor {
	const items = Array.from({ length: count }, (_, index) => ({
		kind: "new-link",
		item: { type: "newLink" },
		searchKey: `item:${index}`,
		virtualKey: `item:${index}`,
	})) as TwoHopVirtualListItem[];
	return {
		section: {
			kind: "new-links-section",
			rawSectionId: "section",
			sectionId: "section",
			sectionKey: "section",
			title: "Section",
			getKey: (_item, index) => `item:${index}`,
		},
		sectionKey: "section",
		sectionId: "section",
		title: "Section",
		totalCount: count,
		loadedCount: count,
		getItems: () => items,
		getItem: (index) => items[index],
		headerProps: {},
	};
}

describe("TwoHop keyed mounted rows", () => {
	it("reuses physical shells while changing logical body keys", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(document, layout);
		const allocator = createTwoHopResidentRowSlotAllocator();
		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 2 },
			rowSlotAllocator: allocator,
		});
		const jumped = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 5, end: 7 },
			previousBuild: first,
			rowSlotAllocator: allocator,
		});

		const firstPhysicalRow = first.rowsBySlot.find((row) => row.slotIndex === 0);
		const jumpedPhysicalRow = jumped.rowsBySlot.find((row) => row.slotIndex === 0);
		expect(firstPhysicalRow?.rowIndex).toBe(0);
		expect(jumpedPhysicalRow?.rowIndex).toBe(5);
		expect(jumpedPhysicalRow?.slotKey).toBe(firstPhysicalRow?.slotKey);
		expect(jumpedPhysicalRow?.cells[0].cellSlotKey).toBe(
			firstPhysicalRow?.cells[0].cellSlotKey,
		);
		expect(jumpedPhysicalRow?.cells[0].renderBodyKey).not.toBe(
			firstPhysicalRow?.cells[0].renderBodyKey,
		);
		expect(jumped.nextRenderSlotIndex).toBe(first.nextRenderSlotIndex);
		expect(jumped.cells).toHaveLength(4);
	});

	it("returns the same build for a resident-window hit", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(document, layout);
		const allocator = createTwoHopResidentRowSlotAllocator();
		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 2, end: 6 },
			rowSlotAllocator: allocator,
		});

		expect(
			buildTwoHopMountedRows({
				rowModel,
				rowRange: { start: 2, end: 6 },
				previousBuild: first,
				rowSlotAllocator: allocator,
			}),
		).toBe(first);
	});

	it("orders recycled resident rows by physical slot without exposing pool holes", () => {
		const document = createTwoHopDocument({
			sections: [createSection(200)],
			visibleCounts: {},
			initialVisibleCount: 200,
		});
		const rowModel = createTwoHopVirtualRowModel(document, layout);
		const allocator = createTwoHopResidentRowSlotAllocator();
		const initial = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 3 },
			rowSlotAllocator: allocator,
		});
		const shifted = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 4 },
			previousBuild: initial,
			rowSlotAllocator: allocator,
		});

		expect(shifted.rowSlices.map((row) => row.slotIndex)).toEqual([1, 2, 0]);
		expect(shifted.rowsBySlot.map((row) => row.slotIndex)).toEqual([0, 1, 2]);
		expect(shifted.rowsBySlot).toHaveLength(shifted.rowSlices.length);
		expect(shifted.slotDelta.enteredSlots).toEqual([]);
		expect(shifted.slotDelta.reboundSlots).toHaveLength(layout.columns);
		expect(shifted.slotDelta.releasedSlots).toEqual([]);
		expect(shifted.rowDelta.enteredRows).toEqual([]);
		expect(shifted.rowDelta.reboundRows).toHaveLength(1);
		expect(shifted.rowDelta.releasedSlotIndexes).toEqual([]);
	});

	it("resolves entering rows through compact geometry and reuses overlapping rows", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(document, layout);
		const getRow = vi.spyOn(rowModel, "getRow");
		const getDocumentSection = vi.spyOn(rowModel, "getDocumentSection");
		const allocator = createTwoHopResidentRowSlotAllocator();
		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 5 },
			rowSlotAllocator: allocator,
		});
		const shifted = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 2, end: 6 },
			previousBuild: first,
			rowSlotAllocator: allocator,
		});

		expect(getRow).not.toHaveBeenCalled();
		expect(getDocumentSection).not.toHaveBeenCalled();
		expect(shifted.rowSlices.slice(0, 3)).toEqual(first.rowSlices.slice(1, 4));
		expect(shifted.rowSlices[0]).toBe(first.rowSlices[1]);
		expect(shifted.rowSlices[3].slotIndex).toBe(first.rowSlices[0].slotIndex);
		expect(shifted.cells).toBe(shifted.cells);
		expect(shifted.reusableCellsByKey).toBe(shifted.reusableCellsByKey);
	});
});
