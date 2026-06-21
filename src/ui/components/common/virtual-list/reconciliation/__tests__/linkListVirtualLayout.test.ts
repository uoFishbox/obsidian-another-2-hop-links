import { describe, expect, it } from "vitest";
import {
	createArrayVirtualGridDataSource,
	createFlatLogicalCellSource,
} from "../../flatLogicalCellSource";
import type { VirtualListLogicalCell } from "../../logicalCell";
import type {
	RenderRevision,
	RenderRevisionFallbackPolicy,
} from "../../renderRevision";
import {
	buildMountedVirtualGridCells,
	type MountedVirtualGridCellsBuildResult,
} from "../linkListVirtualLayout";
import {
	expectKeys,
	expectUniqueRenderSlots,
} from "../../../__tests__/virtualLayoutTestHelpers";

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
	return `item-${index}::item:${index}`;
}

function buildLogicalCells(params: {
	header: boolean;
	items: TestItem[];
	visibleCount: number;
	showLoadMore: boolean;
	getKey: (item: TestItem, index: number) => string;
	sectionId: string;
	getItemRenderRevision?: (
		item: TestItem,
		index: number,
	) => RenderRevision | undefined;
}): VirtualListLogicalCell<TestItem>[] {
	const dataSource = createArrayVirtualGridDataSource({
		items: params.items,
		getKey: params.getKey,
		getItemRenderRevision: params.getItemRenderRevision,
	});
	const source = createFlatLogicalCellSource({
		header: params.header,
		dataSource,
		visibleCount: params.visibleCount,
		showLoadMore: params.showLoadMore,
		sectionId: params.sectionId,
	});
	const cells: VirtualListLogicalCell<TestItem>[] = [];
	for (let index = 0; index < source.cellCount; index += 1) {
		const cell = source.resolveCellAtIndex(index);
		if (cell) {
			cells.push(cell);
		}
	}
	return cells;
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
	const logicalCells = buildLogicalCells({
		header: false,
		items: params.items,
		visibleCount: params.items.length,
		showLoadMore: false,
		getKey: (item) => item.id,
		sectionId: "section-0",
		getItemRenderRevision: params.getItemRenderRevision,
	});

	return buildMountedVirtualGridCells({
		logicalCells,
		visibleWindow: params.visibleWindow ?? {
			start: 0,
			end: logicalCells.length,
		},
		columns: params.columns ?? 3,
		cellWidth: params.cellWidth ?? 100,
		rowHeight: params.rowHeight ?? 120,
		gap: params.gap ?? 10,
		previousBuild: params.previousBuild,
		renderRevisionFallbackPolicy: params.renderRevisionFallbackPolicy,
	});
}

function slotsByKey(
	build: { cells: ReadonlyArray<{ key: string; renderSlotKey: number }> },
): Map<string, number> {
	return new Map(build.cells.map((cell) => [cell.key, cell.renderSlotKey]));
}

function expectSameSlotsForKeys(
	previous: { cells: ReadonlyArray<{ key: string; renderSlotKey: number }> },
	next: { cells: ReadonlyArray<{ key: string; renderSlotKey: number }> },
	keys: string[],
): void {
	const previousSlots = slotsByKey(previous);
	const nextSlots = slotsByKey(next);

	for (const key of keys) {
		expect(nextSlots.get(key)).toBe(previousSlots.get(key));
	}
}

describe("linkListVirtualLayout", () => {
	it("keeps keys, items, positions, and render slots stable when logical cells are rebuilt for the same items", () => {
		const items = createItems(3);

		const initial = buildCells({ items });
		const rebuilt = buildCells({
			items: [...items],
			previousBuild: initial,
		});

		expectKeys(rebuilt.cells).toEqual([
			"item-0::item:0",
			"item-1::item:1",
			"item-2::item:2",
		]);
		expect(rebuilt.cells.map((cell) => cell.cell)).toEqual(
			initial.cells.map((cell) => cell.cell),
		);
		expect(rebuilt.cells.map((cell) => cell.position)).toEqual(
			initial.cells.map((cell) => cell.position),
		);
		expect(rebuilt.cells[0]).toBe(initial.cells[0]);
		expect(rebuilt.cells[1]).toBe(initial.cells[1]);
		expect(rebuilt.cells[2]).toBe(initial.cells[2]);

		expectSameSlotsForKeys(initial, rebuilt, [
			"item-0::item:0",
			"item-1::item:1",
			"item-2::item:2",
		]);
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

		expectKeys(updated.cells).toEqual([
			"item-0::item:0",
			"item-1::item:1",
			"item-2::item:2",
		]);

		const first = updated.cells[0];
		expect(first.cell.kind).toBe("item");

		if (first.cell.kind !== "item") {
			throw new Error("Expected first cell to be an item cell");
		}

		expect(first.cell.item).toBe(updatedItems[0]);
		expect(first.cell.item).not.toBe(initialItems[0]);
		expect(first.cell.item.label).toBe("Updated 0");

		expectSameSlotsForKeys(initial, updated, [
			"item-0::item:0",
			"item-1::item:1",
			"item-2::item:2",
		]);
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

		expectSameSlotsForKeys(
			initial,
			resized,
			[
				itemKey(0),
				itemKey(1),
				itemKey(2),
				itemKey(3),
				itemKey(4),
				itemKey(5),
			],
		);
		expectUniqueRenderSlots(resized.cells);

		expect(resized.cells[0].position).toEqual({
			row: 0,
			column: 0,
			top: 0,
			left: 0,
			width: 120,
			height: 140,
		});

		expect(resized.cells[3].position).toEqual({
			row: 1,
			column: 0,
			top: 150,
			left: 0,
			width: 120,
			height: 140,
		});
	});

	it("mounts only cells inside the visible window", () => {
		const items = createItems(8);

		const result = buildCells({
			items,
			visibleWindow: { start: 2, end: 6 },
			columns: 3,
			cellWidth: 100,
			rowHeight: 120,
			gap: 10,
		});

		expectKeys(result.cells).toEqual([
			itemKey(2),
			itemKey(3),
			itemKey(4),
			itemKey(5),
		]);

		expect(result.cells.map((cell) => cell.cellIndex)).toEqual([2, 3, 4, 5]);
		expect(result.cells[0].position).toMatchObject({
			row: 0,
			column: 2,
			top: 0,
			left: 220,
		});
		expect(result.cells[1].position).toMatchObject({
			row: 1,
			column: 0,
			top: 130,
			left: 0,
		});
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
		expect(build.rowSlices.map((row) => row.key)).toEqual([
			0,
			1,
		]);
		expect(build.rowSlices.map((row) => row.slotKey)).toEqual([
			0,
			1,
		]);
		expect(build.rowSlices.map((row) => row.top)).toEqual([0, 130]);
		expect(
			build.rowSlices.map((row) => row.cells.map((cell) => cell.key)),
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

		expectKeys(shifted.cells).toEqual([
			itemKey(3),
			itemKey(4),
			itemKey(5),
			itemKey(6),
			itemKey(7),
			itemKey(8),
		]);

		expectSameSlotsForKeys(initial, shifted, [
			itemKey(3),
			itemKey(4),
			itemKey(5),
		]);
		expect(shifted.rowSlices.map((row) => row.rowIndex)).toEqual([1, 2]);
		expect(shifted.rowSlices.map((row) => row.slotIndex)).toEqual([1, 0]);
		expectUniqueRenderSlots(shifted.cells);
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

		expect(updated.cells[0].renderBodyKey).toBe(
			initial.cells[0].renderBodyKey,
		);
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

		expect(updated.cells[0].renderBodyKey).not.toBe(
			initial.cells[0].renderBodyKey,
		);
	});

	it("keeps item body keys stable with source-key-only fallback", () => {
		const initialItems: TestItem[] = [
			{ id: "item-0", label: "Initial" },
		];
		const updatedItems: TestItem[] = [
			{ id: "item-0", label: "Updated" },
		];

		const initial = buildCells({
			items: initialItems,
			renderRevisionFallbackPolicy: "source-key-only",
		});
		const updated = buildCells({
			items: updatedItems,
			previousBuild: initial,
			renderRevisionFallbackPolicy: "source-key-only",
		});

		expect(updated.cells[0].renderBodyKey).toBe(
			initial.cells[0].renderBodyKey,
		);
	});

	it("throws for missing item render revisions when fallback policy is required", () => {
		expect(() =>
			buildCells({
				items: [{ id: "item-0", label: "Initial" }],
				renderRevisionFallbackPolicy: "required",
			}),
		).toThrow(
			'Missing item render revision for sourceKey="item-0" cellKey="item-0::item:0".',
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
