import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVirtualSurfaceResidentRowsAdapter } from "ui/virtualization/svelte/residentRowViewState.svelte";
import {
	logicalCellKey,
	renderSlotKey,
	type MountedVirtualCell,
} from "ui/virtualization/types";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";
import ResidentRowsSurfaceHarness from "./ResidentRowsSurfaceHarness.svelte";

interface TestMountedCell extends MountedVirtualCell {
	readonly label: string;
}

interface TestMountedRow extends VirtualSurfaceMountedRow<TestMountedCell> {
	readonly slotIndex: number;
}

function createRow(
	slotIndex: number,
	rowIndex: number,
	label?: string,
): TestMountedRow {
	return {
		key: rowIndex,
		rowIndex,
		top: rowIndex * 100,
		slotIndex,
		slotKey: slotIndex,
		cells:
			label === undefined
				? []
				: [
						{
							key: logicalCellKey(label),
							renderSlotKey: renderSlotKey(slotIndex),
							renderSlotIndex: slotIndex,
							cellSlotKey: slotIndex,
							rowIndex,
							columnIndex: 0,
							label,
						},
					],
	};
}

afterEach(cleanup);

describe("residentRowViewState", () => {
	it("keeps array and retained slot identities while replacing only changed rows", () => {
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		const initialSlot0 = createRow(0, 10);
		const retainedSlot1 = createRow(1, 11);
		adapter.sync([initialSlot0, retainedSlot1], 3);

		const residentRows = adapter.rows;
		const residentSlot0 = residentRows[0];
		const residentSlot1 = residentRows[1];
		const replacementSlot0 = createRow(0, 12);
		adapter.sync([replacementSlot0, retainedSlot1], 3);

		expect(adapter.rows).toBe(residentRows);
		expect(adapter.rows[0]).toBe(residentSlot0);
		expect(adapter.rows[1]).toBe(residentSlot1);
		expect(adapter.rows[0]?.row).toBe(replacementSlot0);
		expect(adapter.rows[1]?.row).toBe(retainedSlot1);
		expect(adapter.rows[2]?.row).toBeUndefined();
	});

	it("preserves holes and recreates the slot array only when capacity changes", () => {
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		const rowInSlot2 = createRow(2, 20);
		adapter.sync([rowInSlot2], 3);
		const initialRows = adapter.rows;

		expect(initialRows.map((residentRow) => residentRow.row)).toEqual([
			undefined,
			undefined,
			rowInSlot2,
		]);

		adapter.sync([], 3);
		expect(adapter.rows).toBe(initialRows);
		expect(adapter.rows.every((residentRow) => residentRow.row === undefined)).toBe(
			true,
		);

		adapter.sync([], 4);
		expect(adapter.rows).not.toBe(initialRows);
		expect(adapter.rows).toHaveLength(4);
	});

	it("does not reevaluate retained row expressions when another slot changes", async () => {
		const resolveCellClassName = vi.fn((cell: TestMountedCell) => cell.label);
		const initialSlot0 = createRow(0, 0, "slot-0-initial");
		const retainedSlot1 = createRow(1, 1, "slot-1-retained");
		const adapter = createVirtualSurfaceResidentRowsAdapter<
			TestMountedCell,
			TestMountedRow
		>();
		adapter.sync([initialSlot0, retainedSlot1], 2);
		render(ResidentRowsSurfaceHarness, {
			props: {
				residentRows: adapter.rows,
				getCellClassName: resolveCellClassName,
			},
		});
		await tick();
		resolveCellClassName.mockClear();

		const replacementSlot0 = createRow(0, 2, "slot-0-replacement");
		adapter.sync([replacementSlot0, retainedSlot1], 2);
		await tick();

		expect(resolveCellClassName).toHaveBeenCalled();
		expect(resolveCellClassName.mock.calls.map(([cell]) => cell.label)).toContain(
			"slot-0-replacement",
		);
		expect(
			resolveCellClassName.mock.calls.map(([cell]) => cell.label),
		).not.toContain("slot-1-retained");
	});
});
