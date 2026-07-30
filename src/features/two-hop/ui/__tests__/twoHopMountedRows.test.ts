import { describe, expect, it, vi } from "vitest";
import { createTwoHopDocument } from "features/two-hop/ui/twoHopDocument";
import { createTwoHopVirtualRowModel } from "features/two-hop/ui/twoHopVirtualRowModel";
import { buildTwoHopMountedRows } from "features/two-hop/ui/twoHopMountedRows";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import { createResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import {
	createLayoutPublication,
	createSectionDataRevision,
} from "features/two-hop/ui/twoHopRevisions";

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
		sourceRevision: createSectionDataRevision(1),
		section: {
			kind: "new-links-section",
			rawSectionId: "section",
			sectionId: "section",
			sectionKey: "section",
			title: "Section",
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
	it("keeps fixed physical cell slots without publishing empty logical cells", () => {
		const document = createTwoHopDocument({
			sections: [createSection(2)],
			visibleCounts: {},
			initialVisibleCount: 2,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const mounted = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 0, end: 2 },
		});

		expect(mounted.rowSlices.map((row) => row.cellSlots.length)).toEqual([2, 2]);
		expect(mounted.rowSlices.map((row) => row.cells.length)).toEqual([2, 1]);
		expect(
			mounted.rowSlices[1]?.cellSlots.map((slot) => slot.binding?.key ?? null),
		).toEqual([mounted.rowSlices[1]?.cells[0]?.key, null]);
		expect(mounted.cells).toHaveLength(3);
		expect(mounted.reusableCellsByKey).toHaveLength(3);
	});

	it("reuses physical shells while changing logical body keys", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const allocator = createResidentRowSlotAllocator();
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

		const firstPhysicalRow = first.occupiedRowsInSlotOrder.find(
			(row) => row.slotIndex === 0,
		);
		const jumpedPhysicalRow = jumped.occupiedRowsInSlotOrder.find(
			(row) => row.slotIndex === 0,
		);
		expect(firstPhysicalRow?.rowIndex).toBe(0);
		expect(jumpedPhysicalRow?.rowIndex).toBe(5);
		expect(jumpedPhysicalRow?.slotKey).toBe(firstPhysicalRow?.slotKey);
		expect(jumpedPhysicalRow?.cells[0].cellSlotKey).toBe(
			firstPhysicalRow?.cells[0].cellSlotKey,
		);
		expect(jumpedPhysicalRow?.cells[0].key).not.toBe(
			firstPhysicalRow?.cells[0].key,
		);
		expect(jumped.cellSlotCapacity).toBe(first.cellSlotCapacity);
		expect(jumped.cells).toHaveLength(4);
	});

	it("returns the same build for a resident-window hit", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const allocator = createResidentRowSlotAllocator();
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

	it("updates row geometry without resetting slots when columns stay unchanged", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const initialRowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const resizedRowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(
				{
					...layout,
					containerWidth: 400,
					cellWidth: 190,
					rowHeight: 140,
					gap: 12,
					sectionMarginBottom: 24,
				},
				2,
			),
		);
		const allocator = createResidentRowSlotAllocator();
		const first = buildTwoHopMountedRows({
			rowModel: initialRowModel,
			rowRange: { start: 1, end: 4 },
			rowSlotAllocator: allocator,
		});
		const resized = buildTwoHopMountedRows({
			rowModel: resizedRowModel,
			rowRange: { start: 1, end: 4 },
			previousBuild: first,
			rowSlotAllocator: allocator,
		});

		expect(resized).not.toBe(first);
		expect(resized.rowSlices[0]?.top).not.toBe(first.rowSlices[0]?.top);
		for (let index = 0; index < resized.rowSlices.length; index += 1) {
			expect(resized.rowSlices[index]?.slotIndex).toBe(
				first.rowSlices[index]?.slotIndex,
			);
		}
	});

	it("resets slots when the column topology changes", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const initialRowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const singleColumnRowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(
				{
					...layout,
					columns: 1,
					cellWidth: 420,
				},
				2,
			),
		);
		const allocator = createResidentRowSlotAllocator();
		const first = buildTwoHopMountedRows({
			rowModel: initialRowModel,
			rowRange: { start: 1, end: 4 },
			rowSlotAllocator: allocator,
		});
		const singleColumn = buildTwoHopMountedRows({
			rowModel: singleColumnRowModel,
			rowRange: { start: 1, end: 4 },
			previousBuild: first,
			rowSlotAllocator: allocator,
		});

		expect(singleColumn.rowSlices[0]).not.toBe(first.rowSlices[0]);
	});

	it("rebuilds row and cell leases after an allocator reset", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const allocator = createResidentRowSlotAllocator();
		const first = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 5 },
			rowSlotAllocator: allocator,
		});
		allocator.reset("source");
		const rebuilt = buildTwoHopMountedRows({
			rowModel,
			rowRange: { start: 1, end: 5 },
			previousBuild: first,
			rowSlotAllocator: allocator,
		});

		expect(rebuilt).not.toBe(first);
		expect(rebuilt.rowSlices[0]).not.toBe(first.rowSlices[0]);
		expect(rebuilt.rowSlices[0]?.slotIndex).toBe(first.rowSlices[0]?.slotIndex);
	});

	it("orders resident rows by physical slot without exposing pool holes", () => {
		const document = createTwoHopDocument({
			sections: [createSection(200)],
			visibleCounts: {},
			initialVisibleCount: 200,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const allocator = createResidentRowSlotAllocator();
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
		expect(shifted.occupiedRowsInSlotOrder.map((row) => row.slotIndex)).toEqual([
			0, 1, 2,
		]);
		expect(shifted.occupiedRowsInSlotOrder).toHaveLength(shifted.rowSlices.length);
		expect(shifted.rowSlices[0]).toBe(initial.rowSlices[1]);
		expect(shifted.rowSlices[1]).toBe(initial.rowSlices[2]);
	});

	it("resolves entering rows through compact geometry and reuses overlapping rows", () => {
		const document = createTwoHopDocument({
			sections: [createSection(20)],
			visibleCounts: {},
			initialVisibleCount: 20,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const getRow = vi.spyOn(rowModel, "getRow");
		const getDocumentSection = vi.spyOn(rowModel, "getDocumentSection");
		const allocator = createResidentRowSlotAllocator();
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

	it("keeps every resident slot defined and replaces only the leaving row", () => {
		const document = createTwoHopDocument({
			sections: [createSection(40)],
			visibleCounts: {},
			initialVisibleCount: 40,
		});
		const rowModel = createTwoHopVirtualRowModel(
			document,
			createLayoutPublication(layout, 1),
		);
		const allocator = createResidentRowSlotAllocator();
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

		expect(allocator.capacity).toBe(4);
		expect(first.occupiedRowsInSlotOrder).toHaveLength(allocator.capacity);
		expect(shifted.occupiedRowsInSlotOrder).toHaveLength(allocator.capacity);

		const changedRows = shifted.occupiedRowsInSlotOrder.filter(
			(row, slotIndex) => row !== first.occupiedRowsInSlotOrder[slotIndex],
		);
		expect(changedRows).toHaveLength(1);
		expect(changedRows[0]?.rowIndex).toBe(5);
		expect(changedRows[0]?.slotIndex).toBe(first.rowSlices[0]?.slotIndex);
	});
});
