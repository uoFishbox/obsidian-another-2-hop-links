import { describe, expect, it, vi } from "vitest";
import { createResidentRowSlotAllocator } from "ui/virtualization/engine/residentRowPool";
import { buildMountedGridRows, type MountedGridRow } from "../mountedGridRows";
import type { RowRange } from "ui/virtualization/model/rowRange";
import {
	logicalCellKey,
	type MountedVirtualCell,
	type VirtualRowModel,
} from "ui/virtualization/model/types";

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
		revision: { content: rowCellCounts, layout: columns },
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
				key: rowIndex,
				index: rowIndex,
				top: rowIndex * rowStride,
				height: rowHeight,
				bottomSpacing: rowIndex === rowCount - 1 ? 0 : gap,
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
	readonly canReusePreviousRows?: boolean;
	readonly allocator?: ReturnType<typeof createResidentRowSlotAllocator>;
}) {
	const allocator = params.allocator ?? createResidentRowSlotAllocator();
	const bindCell = vi.fn(
		(
			cell: TestLogicalCell,
			previous: TestMountedCell | undefined,
			columnIndex: number,
			physicalCellSlot: number,
		): TestMountedCell => ({
			...(previous ?? {}),
			key: previous?.key ?? logicalCellKey(`cell:${cell.label}`),
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
		canReusePreviousRows: params.canReusePreviousRows,
		bindCell: ({ cell, previous, rowIndex, columnIndex, physicalCellSlot }) => ({
			...bindCell(cell, previous, columnIndex, physicalCellSlot),
			rowIndex,
		}),
	});
	return { build, allocator, bindCell };
}

describe("buildMountedGridRows", () => {
	it("keeps one binding per physical column while flattening only occupied cells", () => {
		const { build } = buildRows({ rowModel: createRowModel([2]) });
		const row = build.rowsInMountedRange[0];

		expect(row?.bindings).toHaveLength(4);
		expect(row?.bindings.map((binding) => binding?.label ?? null)).toEqual([
			"cell:0:0",
			"cell:0:1",
			null,
			null,
		]);
		expect(build.cells).toEqual(row?.bindings.filter(Boolean));
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
			previousRows: initial.build.rowsInMountedRange,
			canReusePreviousRows: false,
		});

		expect(rebuilt.build.rowsInMountedRange[0]).not.toBe(
			initial.build.rowsInMountedRange[0],
		);
		expect(rebuilt.bindCell).toHaveBeenCalledTimes(2);
		expect(rebuilt.bindCell.mock.calls.every(([, previous]) => previous)).toBe(
			true,
		);
	});

	it("reuses occupied bindings and creates only columns transitioning from empty", () => {
		const allocator = createResidentRowSlotAllocator();
		const full = buildRows({ rowModel: createRowModel([4]), allocator });
		const partial = buildRows({
			rowModel: createRowModel([2]),
			allocator,
			previousRows: full.build.rowsInMountedRange,
		});
		const restored = buildRows({
			rowModel: createRowModel([4]),
			allocator,
			previousRows: partial.build.rowsInMountedRange,
		});

		expect(partial.bindCell).toHaveBeenCalledTimes(2);
		expect(partial.bindCell.mock.calls.every(([, previous]) => previous)).toBe(
			true,
		);
		expect(
			partial.build.rowsInMountedRange[0]?.bindings.map(
				(binding) => binding !== null,
			),
		).toEqual([true, true, false, false]);

		expect(restored.bindCell).toHaveBeenCalledTimes(4);
		expect(
			restored.bindCell.mock.calls.map(([, previous]) => previous !== undefined),
		).toEqual([true, true, false, false]);
		expect(
			restored.build.rowsInMountedRange[0]?.bindings.every(
				(binding) => binding !== null,
			),
		).toBe(true);
	});

	it("orders rowsByPhysicalSlot by physical slot independently of logical row order", () => {
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
			previousRows: initial.build.rowsInMountedRange,
			canReusePreviousRows: true,
		});

		expect(
			shifted.build.rowsInMountedRange.map((row) => row.physicalRowSlot),
		).toEqual([2, 3, 0, 1]);
		expect(
			shifted.build.rowsByPhysicalSlot.map((row) => row.physicalRowSlot),
		).toEqual([0, 1, 2, 3]);
		expect(shifted.build.rowsByPhysicalSlot.map((row) => row.rowIndex)).toEqual([
			4, 5, 2, 3,
		]);
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
			previousRows: initial.build.rowsInMountedRange,
			canReusePreviousRows: true,
		});

		expect(reused.build.rowsInMountedRange[0]).toBe(
			initial.build.rowsInMountedRange[0],
		);
		expect(reused.build.rowsInMountedRange[1]).toBe(
			initial.build.rowsInMountedRange[1],
		);
		expect(getRow).not.toHaveBeenCalled();
	});
});
