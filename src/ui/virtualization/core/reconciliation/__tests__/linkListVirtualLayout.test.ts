import { describe, expect, it } from "vitest";
import {
	createFlatLogicalCellSource,
	type FlatLogicalCellSource,
} from "../../../flatLogicalCellSource";
import { computeVirtualGridLayout } from "../../../layout/flatGridLayout";
import type {
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../../../renderRevision";
import { createFlatLinkRowModel } from "../../../row-models/flatLinkRowModel";
import {
	buildMountedVirtualGridCellsFromRowModel,
	type MountedVirtualGridCellsBuildResult,
} from "../linkListVirtualLayout";
import {
	expectKeys,
	expectUniqueRenderSlots,
} from "ui/virtualization/__tests__/virtualLayoutTestHelpers";

type TestItem = {
	id: string;
	label: string;
	renderVersion?: RenderRevision;
};
type TestBuildResult = MountedVirtualGridCellsBuildResult<TestItem>;

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
	getItemRenderRevision?: (
		item: TestItem,
		index: number,
	) => RenderRevision | undefined;
}): FlatLogicalCellSource<TestItem> {
	return createFlatLogicalCellSource({
		header: params.header,
		items: params.items,
		getItemId: params.getItemId,
		getItemRenderRevision: params.getItemRenderRevision,
		visibleCount: params.visibleCount,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	});
}

function createRowModel(params: {
	cellSource: FlatLogicalCellSource<TestItem>;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}) {
	const layout = computeVirtualGridLayout({
		containerWidth:
			params.columns * params.cellWidth + params.gap * (params.columns - 1),
		minCellWidth: params.cellWidth,
		gap: params.gap,
		maxColumns: params.columns,
		rowHeight: params.rowHeight,
		cellCount: params.cellSource.cellCount,
	});
	return createFlatLinkRowModel({
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
	getItemRenderRevision?: (
		item: TestItem,
		index: number,
	) => RenderRevision | undefined;
	renderRevisionFallbackPolicy?: RenderRevisionFallbackPolicy;
}): TestBuildResult {
	const cellSource = createLogicalCellSource({
		header: false,
		items: params.items,
		visibleCount: params.items.length,
		showLoadMore: false,
		getItemId: (item) => item.id,
		sectionId: "section-0",
		getItemRenderRevision: params.getItemRenderRevision,
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

	return buildMountedVirtualGridCellsFromRowModel({
		rowModel,
		rowRange: {
			start: Math.floor(Math.max(0, visibleWindow.start) / columns),
			end: Math.ceil(Math.max(0, visibleWindow.end) / columns),
		},
		previousBuild: params.previousBuild,
		renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
	});
}

function slotsByKey(build: {
	cells: ReadonlyArray<{ key: string; renderSlotIndex: number }>;
}): Map<string, number> {
	return new Map(build.cells.map((cell) => [cell.key, cell.renderSlotIndex]));
}

function expectSameSlotsForKeys(
	previous: { cells: ReadonlyArray<{ key: string; renderSlotIndex: number }> },
	next: { cells: ReadonlyArray<{ key: string; renderSlotIndex: number }> },
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
		expect(build.poolCapacity).toBe(10);

		for (const visibleWindow of [
			{ start: 27, end: 30 },
			{ start: 27, end: 57 },
			{ start: 54, end: 57 },
			{ start: 54, end: 84 },
		]) {
			build = buildCells({ items, visibleWindow, previousBuild: build });
			expect(build.poolCapacity).toBe(10);
			expect(
				Math.max(...build.rowSlices.map((row) => row.slotIndex)),
			).toBeLessThan(build.poolCapacity);
			expect(build.rowsBySlot.map((row) => row.slotIndex)).toEqual(
				build.rowsBySlot.map((row) => row.slotIndex).sort((a, b) => a - b),
			);
		}
	});

	it("keeps keys, items, and render slots stable when logical cells are rebuilt for the same items", () => {
		const items = createItems(3);

		const initial = buildCells({ items });
		const rebuilt = buildCells({
			items: [...items],
			previousBuild: initial,
		});

		expectKeys(rebuilt.cells).toEqual([itemKey(0), itemKey(1), itemKey(2)]);
		expect(rebuilt.cells.map((cell) => cell.cell)).toEqual(
			initial.cells.map((cell) => cell.cell),
		);
		expect(rebuilt.cells[0]).toBe(initial.cells[0]);
		expect(rebuilt.cells[1]).toBe(initial.cells[1]);
		expect(rebuilt.cells[2]).toBe(initial.cells[2]);

		expectSameSlotsForKeys(initial, rebuilt, [itemKey(0), itemKey(1), itemKey(2)]);
		expectUniqueRenderSlots(rebuilt.cells);
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

		expectKeys(updated.cells).toEqual([itemKey(0), itemKey(1), itemKey(2)]);

		const first = updated.cells[0];
		expect(first.cell.kind).toBe("item");

		if (first.cell.kind !== "item") {
			throw new Error("Expected first cell to be an item cell");
		}

		expect(first.cell.item).toBe(updatedItems[0]);
		expect(first.cell.item).not.toBe(initialItems[0]);
		expect(first.cell.item.label).toBe("Updated 0");

		expectSameSlotsForKeys(initial, updated, [itemKey(0), itemKey(1), itemKey(2)]);
		expectUniqueRenderSlots(updated.cells);
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

		expectKeys(resized.cells).toEqual([
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
		expectUniqueRenderSlots(resized.cells);

		expect(resized.cellWidth).toBe(120);
		expect(resized.rowHeight).toBe(140);
		expect(resized.rowSlices.map((row) => row.top)).toEqual([0, 150]);
		expect(resized.cells[0].columnIndex).toBe(0);
		expect(resized.cells[3].columnIndex).toBe(0);
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

		expectKeys(result.cells).toEqual([itemKey(3), itemKey(4), itemKey(5)]);

		expect(result.cells.map((cell) => cell.cellIndex)).toEqual([3, 4, 5]);
		expect(result.cells[0]).toMatchObject({ rowIndex: 1, columnIndex: 0 });
		expect(result.cells[1]).toMatchObject({ rowIndex: 1, columnIndex: 1 });
		expect(result.rowSlices[0].top).toBe(130);
		expectUniqueRenderSlots(result.cells);
	});

	it("builds row slices from mounted cells", () => {
		const items = createItems(6);
		const build = buildCells({
			items,
			columns: 3,
			cellWidth: 100,
			rowHeight: 120,
			gap: 10,
		});

		expect(build.rowSlices).toHaveLength(2);
		expect(build.rowSlices.map((row) => row.key)).toEqual([0, 1]);
		expect(build.rowSlices.map((row) => row.slotIndex)).toEqual([0, 1]);
		expect(build.rowSlices.map((row) => row.top)).toEqual([0, 130]);
		expect(build.rowSlices.map((row) => row.cells.map((cell) => cell.key))).toEqual(
			[
				[itemKey(0), itemKey(1), itemKey(2)],
				[itemKey(3), itemKey(4), itemKey(5)],
			],
		);
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

		expectKeys(shifted.cells).toEqual([
			itemKey(3),
			itemKey(4),
			itemKey(5),
			itemKey(6),
			itemKey(7),
			itemKey(8),
		]);

		expectSameSlotsForKeys(initial, shifted, [itemKey(3), itemKey(4), itemKey(5)]);
		expect(shifted.rowSlices.map((row) => row.rowIndex)).toEqual([1, 2]);
		expect(shifted.rowSlices.map((row) => row.slotIndex)).toEqual([1, 0]);
		expectUniqueRenderSlots(shifted.cells);
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
		const initial = buildMountedVirtualGridCellsFromRowModel({
			rowModel,
			rowRange: { start: 0, end: 2 },
		});
		const shifted = buildMountedVirtualGridCellsFromRowModel({
			rowModel,
			rowRange: { start: 1, end: 3 },
			previousBuild: initial,
		});

		expect(shifted.rowSlices[0]).toBe(initial.rowSlices[1]);
		expect(shifted.rowSlices[0].cells).toBe(initial.rowSlices[1].cells);
		expect(shifted.rowSlices[1].slotIndex).toBe(0);
		expect(shifted.rowSlices[1].slotIndex).toBe(initial.rowSlices[0].slotIndex);
	});

	it("keeps item body keys stable when item render revisions are stable", () => {
		const initialItems: TestItem[] = [
			{
				id: "item-0",
				label: "Initial",
				renderVersion: "body-1",
			},
		];
		const updatedItems: TestItem[] = [
			{
				id: "item-0",
				label: "Updated",
				renderVersion: "body-1",
			},
		];

		const initial = buildCells({
			items: initialItems,
			getItemRenderRevision: (item) => item.renderVersion,
		});
		const updated = buildCells({
			items: updatedItems,
			previousBuild: initial,
			getItemRenderRevision: (item) => item.renderVersion,
		});

		expect(updated.cells[0].renderBodyKey).toBe(initial.cells[0].renderBodyKey);
		expect(updated.cells[0].cell).not.toBe(initial.cells[0].cell);
	});

	it("changes item body keys when item render revisions change", () => {
		const initialItems: TestItem[] = [
			{ id: "item-0", label: "Initial", renderVersion: 1 },
		];
		const updatedItems: TestItem[] = [
			{ id: "item-0", label: "Updated", renderVersion: 2 },
		];

		const initial = buildCells({
			items: initialItems,
			getItemRenderRevision: (item) => item.renderVersion,
		});
		const updated = buildCells({
			items: updatedItems,
			previousBuild: initial,
			getItemRenderRevision: (item) => item.renderVersion,
		});

		expect(updated.cells[0].renderBodyKey).not.toBe(initial.cells[0].renderBodyKey);
	});

	it("keeps item body keys stable with source-key-only fallback", () => {
		const initialItems: TestItem[] = [{ id: "item-0", label: "Initial" }];
		const updatedItems: TestItem[] = [{ id: "item-0", label: "Updated" }];

		const initial = buildCells({
			items: initialItems,
			renderRevisionFallbackPolicy: "source-key-only",
		});
		const updated = buildCells({
			items: updatedItems,
			previousBuild: initial,
			renderRevisionFallbackPolicy: "source-key-only",
		});

		expect(updated.cells[0].renderBodyKey).toBe(initial.cells[0].renderBodyKey);
	});

	it("throws for missing item render revisions when fallback policy is required", () => {
		expect(() =>
			buildCells({
				items: [{ id: "item-0", label: "Initial" }],
				renderRevisionFallbackPolicy: "required",
			}),
		).toThrow(
			`Missing item render revision for sourceKey="item-0" cellKey="${itemKey(0)}".`,
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

		expect(shrunk.cells).toEqual([]);
		expect(shrunk.rowSlices).toEqual([]);
		expect(shrunk.reusableCellsByKey.size).toBe(0);
	});
});
