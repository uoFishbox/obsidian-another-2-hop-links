import { describe, expect, it } from "vitest";
import type { LogicalCellKey, MountedVirtualCell } from "cards/virtualization/public";
import type { CardGridMountedRow } from "../cardGridSurfaceTypes";
import { createPhysicalGridSlotPool } from "../physicalGridSlotPool.svelte";

interface TestMountedCell extends MountedVirtualCell {
	readonly columnIndex: number;
}

function createRow(
	physicalRowSlot: number,
	rowIndex: number,
	keys: readonly string[],
): CardGridMountedRow<TestMountedCell> {
	return {
		physicalRowSlot,
		rowIndex,
		top: rowIndex * 50,
		bindings: keys.map((key, columnIndex) => ({
			key: key as LogicalCellKey,
			physicalCellSlot: physicalRowSlot * keys.length + columnIndex,
			rowIndex,
			columnIndex,
		})),
	};
}

describe("physical grid slot pool", () => {
	it("keeps row and cell each inputs stable while one physical row rebounds", () => {
		const pool = createPhysicalGridSlotPool<TestMountedCell>();
		const firstRow = createRow(0, 0, ["A0", "A1"]);
		const secondRow = createRow(1, 1, ["B0", "B1"]);
		const thirdRow = createRow(2, 2, ["C0", "C1"]);
		pool.sync([firstRow, secondRow, thirdRow], 2);

		const stableRows = pool.rows;
		const stableCellRows = stableRows.map((row) => row.cells);
		const firstBindings = stableRows.map((row) =>
			row.cells.map((cell) => cell.binding),
		);
		const reboundSecondRow = createRow(1, 12, ["D0", "D1"]);

		pool.sync([firstRow, reboundSecondRow, thirdRow], 2);

		expect(pool.rows).toBe(stableRows);
		expect(
			pool.rows.every((row, index) => row.cells === stableCellRows[index]),
		).toBe(true);
		expect(pool.rows[0]?.cells.map((cell) => cell.binding)).toStrictEqual(
			firstBindings[0],
		);
		expect(pool.rows[2]?.cells.map((cell) => cell.binding)).toStrictEqual(
			firstBindings[2],
		);
		expect(
			pool.rows[1]?.cells.map((cell) => String(cell.binding?.key)),
		).toStrictEqual(["D0", "D1"]);
	});

	it("retains inactive slots until the column topology changes", () => {
		const pool = createPhysicalGridSlotPool<TestMountedCell>();
		const firstRow = createRow(0, 0, ["A"]);
		const secondRow = createRow(1, 1, ["B"]);
		pool.sync([firstRow, secondRow], 1);
		const stableRows = pool.rows;

		pool.sync([secondRow], 1);

		expect(pool.rows).toBe(stableRows);
		expect(pool.rows).toHaveLength(2);
		expect(pool.rows[0]?.active).toBe(false);
		expect(pool.rows[0]?.cells[0]?.binding).toBeNull();
		expect(pool.rows[1]?.active).toBe(true);

		pool.sync([], 2);

		expect(pool.rows).not.toBe(stableRows);
		expect(pool.rows).toHaveLength(0);
	});
});
