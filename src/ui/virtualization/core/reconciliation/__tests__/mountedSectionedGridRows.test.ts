import { describe, expect, it, vi } from "vitest";
import {
	buildMountedSectionedGridRows,
	type SectionedGridMountedCell,
	type SectionedGridMountedRow,
} from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";

interface TestCell extends SectionedGridMountedCell {
	readonly label: string;
}

type TestRow = SectionedGridMountedRow<TestCell>;

function buildRows(params: {
	readonly columnEnd: number;
	readonly slotIndex: number;
	readonly previousRow?: TestRow;
	readonly canReusePreviousRow?: boolean;
	readonly resolveCell?: ReturnType<typeof vi.fn<(columnIndex: number) => TestCell>>;
	readonly rebindCell?: ReturnType<
		typeof vi.fn<(previous: TestCell, renderSlotIndex: number) => TestCell>
	>;
}) {
	const resolveCell =
		params.resolveCell ??
		vi.fn(
			(columnIndex: number): TestCell => ({
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
		resolveSlotIndex: () => params.slotIndex,
		resolvePreviousRow: () => params.previousRow,
		canReusePreviousRow: () => params.canReusePreviousRow ?? true,
		resolveRow: () => ({
			top: 0,
			columnStart: 0,
			columnEnd: params.columnEnd,
			metadata: null,
		}),
		resolveCell: ({ columnIndex }) => resolveCell(columnIndex),
		rebindCell: ({ previous, renderSlotIndex }) =>
			rebindCell(previous, renderSlotIndex),
		createRow: ({ rowIndex, slotIndex, bindings }) => ({
			rowIndex,
			slotIndex,
			bindings,
		}),
	});

	return { build, resolveCell, rebindCell };
}

describe("buildMountedSectionedGridRows", () => {
	it("keeps one binding per physical column while flattening only occupied cells", () => {
		const { build } = buildRows({ columnEnd: 2, slotIndex: 0 });
		const row = build.rowSlices[0];

		expect(row?.bindings).toHaveLength(4);
		expect(row?.bindings.map((binding) => binding?.label ?? null)).toEqual([
			"cell:0",
			"cell:1",
			null,
			null,
		]);
		expect(build.cells).toEqual(row?.bindings.filter(Boolean));
	});

	it("rebinds physical bindings even when the whole logical row cannot be reused", () => {
		const initial = buildRows({ columnEnd: 2, slotIndex: 0 });
		const rebuilt = buildRows({
			columnEnd: 2,
			slotIndex: 0,
			previousRow: initial.build.rowSlices[0],
			canReusePreviousRow: false,
		});

		expect(rebuilt.build.rowSlices[0]).not.toBe(initial.build.rowSlices[0]);
		expect(rebuilt.rebindCell).toHaveBeenCalledTimes(2);
		expect(rebuilt.resolveCell).not.toHaveBeenCalled();
	});

	it("rebinds occupied bindings and resolves only columns transitioning from empty", () => {
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
			partial.build.rowSlices[0]?.bindings.map((binding) => binding !== null),
		).toEqual([true, true, false, false]);

		expect(restored.rebindCell).toHaveBeenCalledTimes(2);
		expect(restored.resolveCell).toHaveBeenCalledTimes(2);
		expect(
			restored.resolveCell.mock.calls.map(([columnIndex]) => columnIndex),
		).toEqual([2, 3]);
		expect(
			restored.build.rowSlices[0]?.bindings.every((binding) => binding !== null),
		).toBe(true);
	});

	it("orders rowsBySlot by physical slot independently of logical row order", () => {
		const slotByRowIndex = [2, 0, 3, 1];
		const build = buildMountedSectionedGridRows<TestCell, TestRow, null>({
			rowRange: { start: 0, end: 4 },
			columns: 1,
			slotCapacity: 4,
			resolveSlotIndex: (rowIndex) => slotByRowIndex[rowIndex] ?? 0,
			resolvePreviousRow: () => undefined,
			canReusePreviousRow: () => false,
			resolveRow: (rowIndex) => ({
				top: rowIndex,
				columnStart: 0,
				columnEnd: 1,
				metadata: null,
			}),
			resolveCell: ({ columnIndex, renderSlotIndex }) => ({
				columnIndex,
				renderSlotIndex,
				label: `cell:${renderSlotIndex}`,
			}),
			createRow: ({ rowIndex, slotIndex, bindings }) => ({
				rowIndex,
				slotIndex,
				bindings,
			}),
		});

		expect(build.rowsBySlot.map((row) => row.slotIndex)).toEqual([0, 1, 2, 3]);
		expect(build.rowsBySlot.map((row) => row.rowIndex)).toEqual([1, 3, 0, 2]);
	});

	it("throws when a logical row has no resident slot", () => {
		expect(() =>
			buildMountedSectionedGridRows<TestCell, TestRow, null>({
				rowRange: { start: 7, end: 8 },
				columns: 1,
				slotCapacity: 1,
				resolveSlotIndex: () => undefined,
				resolvePreviousRow: () => undefined,
				canReusePreviousRow: () => false,
				resolveRow: () => null,
				resolveCell: () => null,
				createRow: ({ rowIndex, slotIndex, bindings }) => ({
					rowIndex,
					slotIndex,
					bindings,
				}),
			}),
		).toThrowError("No resident slot assigned for row 7.");
	});
});
