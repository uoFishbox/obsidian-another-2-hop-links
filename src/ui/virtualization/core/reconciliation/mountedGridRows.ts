import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { ResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import { clampRange, type RowRange } from "ui/virtualization/rowRange";
import type { MountedVirtualCell, VirtualRowModel } from "ui/virtualization/types";

export interface MountedGridRow<TCell extends MountedVirtualCell> {
	readonly key: number;
	readonly slotIndex: number;
	readonly rowIndex: number;
	readonly top: number;
	readonly bindings: readonly (TCell | null)[];
}

export interface MountedGridRows<TCell extends MountedVirtualCell> {
	readonly cells: TCell[];
	readonly rowSlices: MountedGridRow<TCell>[];
	readonly rowsBySlot: MountedGridRow<TCell>[];
}

export interface BuildMountedGridRowsParams<
	TLogicalCell,
	TCell extends MountedVirtualCell,
> {
	readonly rowModel: VirtualRowModel<TLogicalCell>;
	readonly rowRange: RowRange;
	readonly rowSlotAllocator: ResidentRowSlotAllocator;
	/** Previous contiguous logical rows. Omit when physical slot topology changed. */
	readonly previousRows?: readonly MountedGridRow<TCell>[];
	/** Reuse an unchanged previous row shell without resolving its logical row. */
	readonly canReusePreviousRows?: boolean;
	bindCell(params: {
		readonly cell: TLogicalCell;
		readonly previous?: TCell;
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
	}): TCell;
}

/** Builds resident grid rows directly from the shared virtual row-model contract. */
export function buildMountedGridRows<TLogicalCell, TCell extends MountedVirtualCell>(
	params: BuildMountedGridRowsParams<TLogicalCell, TCell>,
): MountedGridRows<TCell> {
	const { rowModel, rowSlotAllocator } = params;
	const columns = Math.max(1, rowModel.layout.columns);
	const rowRange = clampRange(params.rowRange, rowModel.rowCount);
	rowSlotAllocator.prepareRange({
		start: rowRange.start,
		end: rowRange.end,
		slotTopologyRevision: columns,
	});

	const previousRows = params.previousRows;
	const previousFirstRowIndex = previousRows?.[0]?.rowIndex ?? 0;
	const rowSlices: MountedGridRow<TCell>[] = [];
	let flattenedCells: TCell[] | undefined;

	for (let rowIndex = rowRange.start; rowIndex < rowRange.end; rowIndex += 1) {
		const slotIndex = rowSlotAllocator.resolveSlotIndex(rowIndex);
		if (slotIndex === undefined) {
			throw new Error(`No resident slot assigned for row ${rowIndex}.`);
		}

		const previousRow = previousRows?.[rowIndex - previousFirstRowIndex];
		const matchingPreviousRow =
			previousRow?.rowIndex === rowIndex ? previousRow : undefined;
		if (
			params.canReusePreviousRows &&
			matchingPreviousRow?.slotIndex === slotIndex
		) {
			rowSlices.push(matchingPreviousRow);
			continue;
		}

		const row = rowModel.getRow(rowIndex);
		if (!row) continue;
		const previousBindings =
			matchingPreviousRow?.bindings.length === columns
				? matchingPreviousRow.bindings
				: undefined;
		const bindings: (TCell | null)[] = [];
		for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
			if (columnIndex >= row.cellCount) {
				bindings.push(null);
				continue;
			}
			const cell = row.getCell(columnIndex);
			if (!cell) {
				bindings.push(null);
				continue;
			}
			const renderSlotIndex = slotIndex * columns + columnIndex;
			bindings.push(
				params.bindCell({
					cell,
					previous: previousBindings?.[columnIndex] ?? undefined,
					rowIndex,
					columnIndex,
					renderSlotIndex,
				}),
			);
		}

		recordCCLDevMeasurement("virtualGrid.rowShellCreated");
		rowSlices.push({
			key: rowIndex,
			slotIndex,
			rowIndex,
			top: row.top,
			bindings,
		});
	}

	const rowsBySlot = orderRowsBySlotIndex(rowSlices);
	assertMountedGridRows({
		rows: rowsBySlot,
		slotCapacity: rowSlotAllocator.capacity,
		columns,
	});

	return {
		get cells() {
			if (flattenedCells) return flattenedCells;
			flattenedCells = [];
			for (const row of rowSlices) {
				for (const binding of row.bindings) {
					if (binding) flattenedCells.push(binding);
				}
			}
			return flattenedCells;
		},
		rowSlices,
		rowsBySlot,
	};
}

/** Orders resident rows by physical slot in O(resident rows) without sorting. */
function orderRowsBySlotIndex<TCell extends MountedVirtualCell>(
	rows: readonly MountedGridRow<TCell>[],
): MountedGridRow<TCell>[] {
	const rowsBySlot: (MountedGridRow<TCell> | undefined)[] = [];
	for (const row of rows) rowsBySlot[row.slotIndex] = row;

	let writeIndex = 0;
	for (let readIndex = 0; readIndex < rowsBySlot.length; readIndex += 1) {
		const row = rowsBySlot[readIndex];
		if (row === undefined) continue;
		rowsBySlot[writeIndex] = row;
		writeIndex += 1;
	}
	rowsBySlot.length = writeIndex;
	return rowsBySlot as MountedGridRow<TCell>[];
}

function assertMountedGridRows<TCell extends MountedVirtualCell>(params: {
	readonly rows: readonly MountedGridRow<TCell>[];
	readonly slotCapacity: number;
	readonly columns: number;
}): void {
	if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
		return;
	}

	const logicalRows = new Set<number>();
	const rowSlots = new Set<number>();
	for (const row of params.rows) {
		if (logicalRows.has(row.rowIndex)) {
			throw new Error(`Duplicate mounted logical row: ${row.rowIndex}.`);
		}
		if (
			row.slotIndex < 0 ||
			row.slotIndex >= params.slotCapacity ||
			rowSlots.has(row.slotIndex)
		) {
			throw new Error(`Invalid or duplicate mounted row slot: ${row.slotIndex}.`);
		}
		if (row.bindings.length !== params.columns) {
			throw new Error(
				`Mounted row ${row.rowIndex} has ${row.bindings.length} bindings; expected ${params.columns}.`,
			);
		}
		logicalRows.add(row.rowIndex);
		rowSlots.add(row.slotIndex);

		for (let columnIndex = 0; columnIndex < row.bindings.length; columnIndex += 1) {
			const binding = row.bindings[columnIndex];
			if (!binding) continue;
			const expectedSlotIndex = row.slotIndex * params.columns + columnIndex;
			if (binding.renderSlotIndex !== expectedSlotIndex) {
				throw new Error(
					`Mounted cell render slot ${binding.renderSlotIndex} does not match physical slot ${expectedSlotIndex}.`,
				);
			}
			if (
				binding.columnIndex !== undefined &&
				binding.columnIndex !== columnIndex
			) {
				throw new Error(
					`Mounted cell column ${binding.columnIndex} does not match physical column ${columnIndex}.`,
				);
			}
		}
	}
}
