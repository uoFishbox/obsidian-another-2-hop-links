import { describe, expect, it, vi } from "vitest";
import { createResidentRowSlotAllocator } from "cards/virtualization/engine/mountedGridRows";
import { buildMountedGridRows, type MountedGridRow } from "../mountedGridRows";
import type { RowRange } from "cards/virtualization/model/ranges";
import {
	logicalCellKey,
	type MountedVirtualCell,
	type VirtualRowModel,
} from "cards/virtualization/model/types";

interface TestLogicalCell {
	readonly label: string;
}

interface TestMountedCell extends MountedVirtualCell {
	readonly columnIndex: number;
	readonly label: string;
}

type TestRow = MountedGridRow<TestMountedCell>;

function createRowModel(rowCellCounts: readonly number[], columns = 4) {
	const rowHeight = 100;
	const gap = 10;
	const rowStride = rowHeight + gap;
	const rowCount = rowCellCounts.length;
	const model: VirtualRowModel<TestLogicalCell> = {
		rowCount,
		totalHeight: rowCount > 0 ? rowCount * rowStride - gap : 0,
		layout: {
			containerWidth: columns * 100,
			columns,
			cellWidth: 100,
			gap,
			rowHeight,
			contentHeight: rowCount > 0 ? rowCount * rowStride - gap : 0,
		},
		getRow(rowIndex) {
			if (rowIndex < 0 || rowIndex >= rowCount) return null;
			const cellCount = Math.min(columns, rowCellCounts[rowIndex] ?? 0);
			return {
				top: rowIndex * rowStride,
				cellCount,
				getCell(columnIndex) {
					return columnIndex >= 0 && columnIndex < cellCount
						? { label: `cell:${rowIndex}:${columnIndex}` }
						: null;
				},
			};
		},
		findVisibleRangeInto(out) {
			out.start = 0;
			out.end = rowCount;
		},
		findVisibleRangesInto(out) {
			out.mounted.start = 0;
			out.mounted.end = rowCount;
			out.previewVisible.start = 0;
			out.previewVisible.end = rowCount;
		},
	};
	return model;
}

function buildRows(params: {
	readonly rowModel: VirtualRowModel<TestLogicalCell>;
	readonly rowRange?: RowRange;
	readonly previousRows?: readonly TestRow[];
	readonly allocator?: ReturnType<typeof createResidentRowSlotAllocator>;
	readonly transformBinding?: (binding: TestMountedCell) => TestMountedCell;
}) {
	const allocator = params.allocator ?? createResidentRowSlotAllocator();
	const bindCell = vi.fn(
		(
			cell: TestLogicalCell,
			columnIndex: number,
			physicalCellSlot: number,
		): TestMountedCell => ({
			key: logicalCellKey(`cell:${cell.label}`),
			rowIndex: 0,
			columnIndex,
			physicalCellSlot,
			label: cell.label,
		}),
	);
	const build = buildMountedGridRows<TestLogicalCell, TestMountedCell>({
		rowModel: params.rowModel,
		rowRange: params.rowRange ?? { start: 0, end: 1 },
		rowSlotAllocator: allocator,
		previousRows: params.previousRows,
		bindCell: (cell, physicalCellSlot, rowIndex, columnIndex) => {
			const binding = {
				...bindCell(cell, columnIndex, physicalCellSlot),
				rowIndex,
			};
			return params.transformBinding?.(binding) ?? binding;
		},
	});
	return { build, allocator, bindCell };
}

describe("buildMountedGridRows", () => {
	it("keeps one binding per physical column", () => {
		const { build } = buildRows({ rowModel: createRowModel([2]) });
		const row = build[0];

		expect(row?.bindings).toHaveLength(4);
		expect(row?.bindings.map((binding) => binding?.label ?? null)).toEqual([
			"cell:0:0",
			"cell:0:1",
			null,
			null,
		]);
	});

	it("rebinds physical bindings when the logical row shell cannot be reused", () => {
		const allocator = createResidentRowSlotAllocator();
		const initial = buildRows({
			rowModel: createRowModel([2]),
			allocator,
		});
		const rebuilt = buildRows({
			rowModel: createRowModel([2]),
			allocator,
		});

		expect(rebuilt.build[0]).not.toBe(initial.build[0]);
		expect(rebuilt.bindCell).toHaveBeenCalledTimes(2);
		expect(rebuilt.build[0]?.bindings).toEqual(initial.build[0]?.bindings);
	});

	it("rebuilds occupied columns without changing previously published rows", () => {
		const allocator = createResidentRowSlotAllocator();
		const full = buildRows({ rowModel: createRowModel([4]), allocator });
		const partial = buildRows({
			rowModel: createRowModel([2]),
			allocator,
		});
		const restored = buildRows({
			rowModel: createRowModel([4]),
			allocator,
		});

		expect(partial.bindCell).toHaveBeenCalledTimes(2);
		expect(partial.build[0]?.bindings.map((binding) => binding !== null)).toEqual([
			true,
			true,
			false,
			false,
		]);

		expect(restored.bindCell).toHaveBeenCalledTimes(4);
		expect(full.build[0]?.bindings.every((binding) => binding !== null)).toBe(true);
		expect(restored.build[0]?.bindings.every((binding) => binding !== null)).toBe(
			true,
		);
	});

	it("keeps mounted rows in logical order while physical slots rotate", () => {
		const allocator = createResidentRowSlotAllocator();
		const model = createRowModel([1, 1, 1, 1, 1, 1], 1);
		const initial = buildRows({
			rowModel: model,
			rowRange: { start: 0, end: 4 },
			allocator,
		});
		const shifted = buildRows({
			rowModel: model,
			rowRange: { start: 2, end: 6 },
			allocator,
			previousRows: initial.build,
		});

		expect(shifted.build.map((row) => row.physicalRowSlot)).toEqual([2, 3, 0, 1]);
		expect(shifted.build.map((row) => row.rowIndex)).toEqual([2, 3, 4, 5]);
	});

	it("reuses unchanged resident row shells without resolving their row model", () => {
		const allocator = createResidentRowSlotAllocator();
		const model = createRowModel([1, 1]);
		const initial = buildRows({
			rowModel: model,
			rowRange: { start: 0, end: 2 },
			allocator,
		});
		const getRow = vi.spyOn(model, "getRow");
		const reused = buildRows({
			rowModel: model,
			rowRange: { start: 0, end: 2 },
			allocator,
			previousRows: initial.build,
		});

		expect(reused.build[0]).toBe(initial.build[0]);
		expect(reused.build[1]).toBe(initial.build[1]);
		expect(getRow).not.toHaveBeenCalled();
	});

	it("rejects a binding assigned to another logical row", () => {
		expect(() =>
			buildRows({
				rowModel: createRowModel([1]),
				transformBinding: (binding) => ({ ...binding, rowIndex: 1 }),
			}),
		).toThrow("belongs to row 1; expected 0");
	});

	it("rejects duplicate logical cell keys across mounted rows", () => {
		expect(() =>
			buildRows({
				rowModel: createRowModel([1, 1], 1),
				rowRange: { start: 0, end: 2 },
				transformBinding: (binding) => ({
					...binding,
					key: logicalCellKey("duplicate"),
				}),
			}),
		).toThrow("Duplicate mounted logical cell key: duplicate");
	});

	it("rejects duplicate physical cell slots", () => {
		expect(() =>
			buildRows({
				rowModel: createRowModel([2]),
				transformBinding: (binding) => ({
					...binding,
					physicalCellSlot: 0,
				}),
			}),
		).toThrow("Duplicate mounted physical cell slot: 0");
	});
});
