import { describe, expect, it } from "vitest";
import { createFlatGridCellSource, type FlatGridCellSource } from "../cellSource";
import { computeFlatGridLayout } from "cards/virtualization/public";
import { createFlatGridRowModel } from "../rowModel";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "cards/virtualization/public";
import { buildMountedFlatGridCells, type MountedFlatGridBuild } from "../mountedCells";
import {
	expectKeys,
	expectUniquePhysicalCellSlots,
	flattenMountedRowBindings,
} from "./mountedCellsTestHelpers";

type TestItem = {
	id: string;
	label: string;
};
type TestBuildResult = MountedFlatGridBuild<TestItem>;
const rowSlotAllocators = new WeakMap<TestBuildResult, ResidentRowSlotAllocator>();

function createItems(count: number): TestItem[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `item-${index}`,
		label: `Item ${index}`,
	}));
}

function itemKey(index: number): string {
	const itemId = `item-${index}`;
	return `flat:9:section-0:item:${itemId.length}:${itemId}`;
}

function createLogicalCellSource(params: {
	header: boolean;
	items: TestItem[];
	visibleCount: number;
	showLoadMore: boolean;
	getItemId: (item: TestItem, index: number) => string;
	sectionId: string;
}): FlatGridCellSource<TestItem> {
	return createFlatGridCellSource({
		header: params.header,
		items: params.items,
		getItemId: params.getItemId,
		visibleCount: params.visibleCount,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	});
}

function createRowModel(params: {
	cellSource: FlatGridCellSource<TestItem>;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}) {
	const layout = computeFlatGridLayout({
		containerWidth:
			params.columns * params.cellWidth + params.gap * (params.columns - 1),
		minCellWidth: params.cellWidth,
		gap: params.gap,
		maxColumns: params.columns,
		rowHeight: params.rowHeight,
		cellCount: params.cellSource.cellCount,
	});
	return createFlatGridRowModel({
		cellSource: params.cellSource,
		layout,
	});
}

function buildCells(params: {
	items: TestItem[];
	visibleWindow?: { start: number; end: number };
	columns?: number;
	cellWidth?: number;
	rowHeight?: number;
	gap?: number;
	previousBuild?: TestBuildResult;
	rowSlotAllocator?: ResidentRowSlotAllocator;
}): TestBuildResult {
	const cellSource = createLogicalCellSource({
		header: false,
		items: params.items,
		visibleCount: params.items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "section-0",
	});
	const columns = params.columns ?? 3;
	const cellWidth = params.cellWidth ?? 100;
	const rowHeight = params.rowHeight ?? 120;
	const gap = params.gap ?? 10;
	const rowModel = createRowModel({
		cellSource,
		columns,
		cellWidth,
		rowHeight,
		gap,
	});
	const visibleWindow = params.visibleWindow ?? {
		start: 0,
		end: cellSource.cellCount,
	};

	const rowSlotAllocator =
		params.rowSlotAllocator ??
		(params.previousBuild
			? rowSlotAllocators.get(params.previousBuild)
			: undefined) ??
		createResidentRowSlotAllocator();
	const build = buildMountedFlatGridCells({
		rowModel,
		rowRange: {
			start: Math.floor(Math.max(0, visibleWindow.start) / columns),
			end: Math.ceil(Math.max(0, visibleWindow.end) / columns),
		},
		previousBuild: params.previousBuild,
		rowSlotAllocator,
	});
	rowSlotAllocators.set(build, rowSlotAllocator);
	return build;
}

function getMountedCells(build: TestBuildResult) {
	return flattenMountedRowBindings(build.rowsInMountedRange);
}

function slotsByKey(build: TestBuildResult): Map<string, number> {
	return new Map(
		getMountedCells(build).map((cell) => [cell.key, cell.physicalCellSlot]),
	);
}

function expectSameSlotsForKeys(
	previous: TestBuildResult,
	next: TestBuildResult,
	keys: string[],
): void {
	const previousSlots = slotsByKey(previous);
	const nextSlots = slotsByKey(next);

	for (const key of keys) {
		expect(nextSlots.get(key)).toBe(previousSlots.get(key));
	}
}

describe("linkListVirtualLayout", () => {
	it("keeps the peak row-slot capacity when the mounted window repeatedly shrinks", () => {
		const items = createItems(90);
		let build = buildCells({
			items,
			visibleWindow: { start: 0, end: 30 },
		});
		const initialSlots = new Set(
			build.rowsInMountedRange.map((row) => row.physicalRowSlot),
		);
		expect(initialSlots.size).toBe(10);

		for (const visibleWindow of [
			{ start: 27, end: 30 },
			{ start: 27, end: 57 },
			{ start: 54, end: 57 },
			{ start: 54, end: 84 },
		]) {
			build = buildCells({ items, visibleWindow, previousBuild: build });
			expect(
				build.rowsInMountedRange.every((row) =>
					initialSlots.has(row.physicalRowSlot),
				),
			).toBe(true);
		}
	});

	it("keeps keys, items, and render slots stable when logical cells are rebuilt for the same items", () => {
		const items = createItems(3);

		const initial = buildCells({ items });
		const rebuilt = buildCells({
			items: [...items],
			previousBuild: initial,
		});
		const initialCells = getMountedCells(initial);
		const rebuiltCells = getMountedCells(rebuilt);

		expectKeys(rebuiltCells).toEqual([itemKey(0), itemKey(1), itemKey(2)]);
		expect(rebuiltCells.map((cell) => cell.cell)).toEqual(
			initialCells.map((cell) => cell.cell),
		);
		expect(rebuiltCells[0]).toBe(initialCells[0]);
		expect(rebuiltCells[1]).toBe(initialCells[1]);
		expect(rebuiltCells[2]).toBe(initialCells[2]);

		expectSameSlotsForKeys(initial, rebuilt, [itemKey(0), itemKey(1), itemKey(2)]);
		expectUniquePhysicalCellSlots(rebuiltCells);
	});

	it("updates the mounted item payload when an item changes under the same key", () => {
		const initialItems = createItems(3);
		const updatedItems = initialItems.map((item, index) => ({
			id: item.id,
			label: `Updated ${index}`,
		}));

		const initial = buildCells({ items: initialItems });
		const updated = buildCells({
			items: updatedItems,
			previousBuild: initial,
		});
		const updatedCells = getMountedCells(updated);

		expectKeys(updatedCells).toEqual([itemKey(0), itemKey(1), itemKey(2)]);

		const first = updatedCells[0]!;
		expect(first.cell.kind).toBe("item");

		if (first.cell.kind !== "item") {
			throw new Error("Expected first cell to be an item cell");
		}

		expect(first.cell.item).toBe(updatedItems[0]);
		expect(first.cell.item).not.toBe(initialItems[0]);
		expect(first.cell.item.label).toBe("Updated 0");

		expectSameSlotsForKeys(initial, updated, [itemKey(0), itemKey(1), itemKey(2)]);
		expectUniquePhysicalCellSlots(updatedCells);
	});

	it("recomputes positions while preserving key-to-slot mapping when layout metrics change", () => {
		const items = createItems(6);

		const initial = buildCells({
			items,
			columns: 3,
			cellWidth: 100,
			rowHeight: 120,
			gap: 10,
		});

		const resized = buildCells({
			items,
			columns: 3,
			cellWidth: 120,
			rowHeight: 140,
			gap: 10,
			previousBuild: initial,
		});
		const initialCells = getMountedCells(initial);
		const resizedCells = getMountedCells(resized);

		expectKeys(resizedCells).toEqual([
			itemKey(0),
			itemKey(1),
			itemKey(2),
			itemKey(3),
			itemKey(4),
			itemKey(5),
		]);

		expectSameSlotsForKeys(initial, resized, [
			itemKey(0),
			itemKey(1),
			itemKey(2),
			itemKey(3),
			itemKey(4),
			itemKey(5),
		]);
		expectUniquePhysicalCellSlots(resizedCells);

		expect(resized.cellWidth).toBe(120);
		expect(resized.rowHeight).toBe(140);
		expect(resized.rowsInMountedRange.map((row) => row.top)).toEqual([0, 150]);
		expect(resized.rowsInMountedRange[0]).not.toBe(initial.rowsInMountedRange[0]);
		expect(resizedCells[0]).toBe(initialCells[0]);
		expect(resizedCells[1]).toBe(initialCells[1]);
		expect(resizedCells[2]).toBe(initialCells[2]);
		expect(resizedCells[3]).toBe(initialCells[3]);
		expect(resizedCells[4]).toBe(initialCells[4]);
		expect(resizedCells[5]).toBe(initialCells[5]);
		expect(resizedCells[0]?.columnIndex).toBe(0);
		expect(resizedCells[3]?.columnIndex).toBe(0);
	});

	it("mounts only cells inside the visible row window", () => {
		const items = createItems(8);

		const result = buildCells({
			items,
			visibleWindow: { start: 3, end: 6 },
			columns: 3,
			cellWidth: 100,
			rowHeight: 120,
			gap: 10,
		});
		const cells = getMountedCells(result);

		expectKeys(cells).toEqual([itemKey(3), itemKey(4), itemKey(5)]);

		expect(cells.map((cell) => cell.cellIndex)).toEqual([3, 4, 5]);
		expect(cells[0]).toMatchObject({ rowIndex: 1, columnIndex: 0 });
		expect(cells[1]).toMatchObject({ rowIndex: 1, columnIndex: 1 });
		expect(result.rowsInMountedRange[0].top).toBe(130);
		expectUniquePhysicalCellSlots(cells);
	});

	it("builds mounted cells inside logical row slices", () => {
		const items = createItems(6);
		const build = buildCells({
			items,
			columns: 3,
			cellWidth: 100,
			rowHeight: 120,
			gap: 10,
		});

		expect(build.rowsInMountedRange).toHaveLength(2);
		expect(build.rowsInMountedRange.map((row) => row.rowIndex)).toEqual([0, 1]);
		expect(build.rowsInMountedRange.map((row) => row.physicalRowSlot)).toEqual([
			0, 1,
		]);
		expect(build.rowsInMountedRange.map((row) => row.top)).toEqual([0, 130]);
		expect(
			build.rowsInMountedRange.map((row) =>
				row.bindings.filter((cell) => cell !== null).map((cell) => cell.key),
			),
		).toEqual([
			[itemKey(0), itemKey(1), itemKey(2)],
			[itemKey(3), itemKey(4), itemKey(5)],
		]);
	});

	it("renders a shifted visible window in visual row order", () => {
		const items = createItems(9);

		const initial = buildCells({
			items,
			visibleWindow: { start: 0, end: 6 },
			columns: 3,
		});

		const shifted = buildCells({
			items,
			visibleWindow: { start: 3, end: 9 },
			columns: 3,
			previousBuild: initial,
		});
		const shiftedCells = getMountedCells(shifted);

		expectKeys(shiftedCells).toEqual([
			itemKey(3),
			itemKey(4),
			itemKey(5),
			itemKey(6),
			itemKey(7),
			itemKey(8),
		]);

		expectSameSlotsForKeys(initial, shifted, [itemKey(3), itemKey(4), itemKey(5)]);
		expect(shifted.rowsInMountedRange.map((row) => row.rowIndex)).toEqual([1, 2]);
		expect(shifted.rowsInMountedRange.map((row) => row.physicalRowSlot)).toEqual([
			1, 0,
		]);
		expectUniquePhysicalCellSlots(shiftedCells);
	});

	it("reuses retained row slices when scrolling with the same cell source", () => {
		const items = createItems(9);
		const cellSource = createLogicalCellSource({
			header: false,
			items,
			visibleCount: items.length,
			showLoadMore: false,
			getItemId: (item) => item.id,
			sectionId: "section-0",
		});
		const rowModel = createRowModel({
			cellSource,
			columns: 3,
			cellWidth: 100,
			rowHeight: 120,
			gap: 10,
		});
		const rowSlotAllocator = createResidentRowSlotAllocator();
		const initial = buildMountedFlatGridCells({
			rowModel,
			rowRange: { start: 0, end: 2 },
			rowSlotAllocator,
		});
		const shifted = buildMountedFlatGridCells({
			rowModel,
			rowRange: { start: 1, end: 3 },
			previousBuild: initial,
			rowSlotAllocator,
		});

		expect(shifted.rowsInMountedRange[0]).toBe(initial.rowsInMountedRange[1]);
		expect(shifted.rowsInMountedRange[0].bindings).toBe(
			initial.rowsInMountedRange[1].bindings,
		);
		expect(shifted.rowsInMountedRange[1].physicalRowSlot).toBe(0);
		expect(shifted.rowsInMountedRange[1].physicalRowSlot).toBe(
			initial.rowsInMountedRange[0].physicalRowSlot,
		);
	});

	it("clamps a stale visible window when the logical cell count shrinks", () => {
		const initialItems = createItems(8);

		const initial = buildCells({
			items: initialItems,
			visibleWindow: { start: 3, end: 8 },
			columns: 3,
		});

		const smallerItems = createItems(2);

		const shrunk = buildCells({
			items: smallerItems,
			visibleWindow: { start: 3, end: 8 },
			columns: 3,
			previousBuild: initial,
		});

		expect(getMountedCells(shrunk)).toEqual([]);
		expect(shrunk.rowsInMountedRange).toEqual([]);
	});
});
