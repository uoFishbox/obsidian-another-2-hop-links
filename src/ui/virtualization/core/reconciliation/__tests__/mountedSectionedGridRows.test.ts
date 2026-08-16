import { describe, expect, it, vi } from "vitest";
import {
	buildMountedSectionedGridRows,
	type SectionedGridMountedCell,
	type SectionedGridMountedCellSlot,
	type SectionedGridMountedRow,
} from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";
import {
	rowSlotIndex,
	type ResidentRowSlotLease,
	type ResidentSlotPoolId,
} from "ui/virtualization/core/residentSlotBinding";

const TEST_POOL_ID = Object.freeze({}) as ResidentSlotPoolId;

function createTestLease(slotIndex: number): ResidentRowSlotLease {
	return {
		poolId: TEST_POOL_ID,
		poolEpoch: 0,
		rowSlotIndex: rowSlotIndex(slotIndex),
		rowSlotGeneration: 1,
	};
}

interface TestCell extends SectionedGridMountedCell {
	readonly label: string;
}

interface TestRow extends SectionedGridMountedRow<TestCell> {
	readonly cellSlots: readonly SectionedGridMountedCellSlot<TestCell>[];
}

function buildRows(params: {
	readonly columnEnd: number;
	readonly slotIndex: number;
	readonly previousRow?: TestRow;
	readonly resolveCell?: ReturnType<typeof vi.fn<(columnIndex: number) => TestCell>>;
	readonly rebindCell?: ReturnType<
		typeof vi.fn<(previous: TestCell, renderSlotIndex: number) => TestCell>
	>;
}) {
	const resolveCell =
		params.resolveCell ??
		vi.fn(
			(columnIndex: number): TestCell => ({
				key: `cell:${columnIndex}`,
				columnIndex,
				renderSlotIndex: params.slotIndex * 4 + columnIndex,
				label: `cell:${columnIndex}`,
			}),
		);
	const rebindCell =
		params.rebindCell ??
		vi.fn(
			(previous: TestCell, renderSlotIndex: number): TestCell => ({
				...previous,
				renderSlotIndex,
			}),
		);

	const build = buildMountedSectionedGridRows<TestCell, TestRow, null>({
		rowRange: { start: 0, end: 1 },
		columns: 4,
		slotCapacity: 2,
		resolveSlotLease: () => createTestLease(params.slotIndex),
		resolvePreviousRow: () => params.previousRow,
		canReusePreviousRow: () => true,
		resolveRow: () => ({
			top: 0,
			columnStart: 0,
			columnEnd: params.columnEnd,
			metadata: null,
		}),
		resolveCell: ({ columnIndex }) => resolveCell(columnIndex),
		rebindCell: ({ previous, renderSlotIndex }) =>
			rebindCell(previous, renderSlotIndex),
		createRow: ({ rowIndex, slotIndex, cells, cellSlots }) => ({
			rowIndex,
			slotIndex,
			cells,
			cellSlots,
		}),
	});

	return { build, resolveCell, rebindCell };
}

describe("buildMountedSectionedGridRows", () => {
	it("keeps physical slots fixed while logical cells remain compact", () => {
		const { build } = buildRows({ columnEnd: 2, slotIndex: 0 });
		const row = build.rowSlices[0];

		expect(row?.cellSlots).toHaveLength(4);
		expect(row?.cells).toHaveLength(2);
		expect(row?.cellSlots.map((slot) => slot.columnIndex)).toEqual([0, 1, 2, 3]);
		expect(row?.cellSlots.map((slot) => slot.binding?.key ?? null)).toEqual([
			"cell:0",
			"cell:1",
			null,
			null,
		]);
		expect(build.cells).toEqual(row?.cells);
		expect(Array.from(build.reusableCellsByKey.keys())).toEqual([
			"cell:0",
			"cell:1",
		]);
	});

	it("rebinds occupied slots and resolves only slots transitioning from empty", () => {
		const full = buildRows({ columnEnd: 4, slotIndex: 0 });
		const partial = buildRows({
			columnEnd: 2,
			slotIndex: 1,
			previousRow: full.build.rowSlices[0],
		});
		const restored = buildRows({
			columnEnd: 4,
			slotIndex: 0,
			previousRow: partial.build.rowSlices[0],
		});

		expect(partial.rebindCell).toHaveBeenCalledTimes(2);
		expect(partial.resolveCell).not.toHaveBeenCalled();
		expect(
			partial.build.rowSlices[0]?.cellSlots.map((slot) => slot.binding !== null),
		).toEqual([true, true, false, false]);

		expect(restored.rebindCell).toHaveBeenCalledTimes(2);
		expect(restored.resolveCell).toHaveBeenCalledTimes(2);
		expect(
			restored.resolveCell.mock.calls.map(([columnIndex]) => columnIndex),
		).toEqual([2, 3]);
		expect(
			restored.build.rowSlices[0]?.cellSlots.every(
				(slot) => slot.binding !== null,
			),
		).toBe(true);
	});

	it("orders rowsBySlot by physical slot independently of logical row order", () => {
		const slotByRowIndex = [2, 0, 3, 1];
		const build = buildMountedSectionedGridRows<TestCell, TestRow, null>({
			rowRange: { start: 0, end: 4 },
			columns: 1,
			slotCapacity: 4,
			resolveSlotLease: (rowIndex) =>
				createTestLease(slotByRowIndex[rowIndex] ?? 0),
			resolvePreviousRow: () => undefined,
			canReusePreviousRow: () => false,
			resolveRow: (rowIndex) => ({
				top: rowIndex,
				columnStart: 0,
				columnEnd: 1,
				metadata: null,
			}),
			resolveCell: ({ columnIndex, renderSlotIndex }) => ({
				key: `cell:${renderSlotIndex}`,
				columnIndex,
				renderSlotIndex,
				label: `cell:${renderSlotIndex}`,
			}),
			createRow: ({ rowIndex, slotIndex, cells, cellSlots }) => ({
				rowIndex,
				slotIndex,
				cells,
				cellSlots,
			}),
		});

		expect(build.rowsBySlot.map((row) => row.slotIndex)).toEqual([0, 1, 2, 3]);
		expect(build.rowsBySlot.map((row) => row.rowIndex)).toEqual([1, 3, 0, 2]);
	});

	it("throws when a logical row has no resident slot lease", () => {
		expect(() =>
			buildMountedSectionedGridRows<TestCell, TestRow, null>({
				rowRange: { start: 7, end: 8 },
				columns: 1,
				slotCapacity: 1,
				resolveSlotLease: () => undefined,
				resolvePreviousRow: () => undefined,
				canReusePreviousRow: () => false,
				resolveRow: () => null,
				resolveCell: () => null,
				createRow: ({ rowIndex, slotIndex, cells, cellSlots }) => ({
					rowIndex,
					slotIndex,
					cells,
					cellSlots,
				}),
			}),
		).toThrowError("No resident slot assigned for row 7.");
	});
});
