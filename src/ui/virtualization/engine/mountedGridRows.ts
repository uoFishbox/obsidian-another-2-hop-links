import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import type { ResidentRowSlotAllocator } from "ui/virtualization/engine/residentRowPool";
import { clampRange, type RowRange } from "ui/virtualization/model/rowRange";
import type {
	MountedVirtualCell,
	VirtualRowModel,
} from "ui/virtualization/model/types";

export interface MountedGridRow<TCell extends MountedVirtualCell> {
	readonly key: number;
	readonly physicalRowSlot: number;
	readonly rowIndex: number;
	readonly top: number;
	readonly bindings: readonly (TCell | null)[];
}

export interface MountedGridRows<TCell extends MountedVirtualCell> {
	readonly cells: TCell[];
	readonly rowsInMountedRange: MountedGridRow<TCell>[];
	readonly rowsByPhysicalSlot: MountedGridRow<TCell>[];
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
		readonly physicalCellSlot: number;
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
	const rowsInMountedRange: MountedGridRow<TCell>[] = [];
	let flattenedCells: TCell[] | undefined;

	for (let rowIndex = rowRange.start; rowIndex < rowRange.end; rowIndex += 1) {
		const physicalRowSlot = rowSlotAllocator.resolveSlotIndex(rowIndex);
		if (physicalRowSlot === undefined) {
			throw new Error(`No resident slot assigned for row ${rowIndex}.`);
		}

		const previousRow = previousRows?.[rowIndex - previousFirstRowIndex];
		const matchingPreviousRow =
			previousRow?.rowIndex === rowIndex ? previousRow : undefined;
		if (
			params.canReusePreviousRows &&
			matchingPreviousRow?.physicalRowSlot === physicalRowSlot
		) {
			rowsInMountedRange.push(matchingPreviousRow);
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
			const physicalCellSlot = physicalRowSlot * columns + columnIndex;
			bindings.push(
				params.bindCell({
					cell,
					previous: previousBindings?.[columnIndex] ?? undefined,
					rowIndex,
					columnIndex,
					physicalCellSlot,
				}),
			);
		}

		recordCCLDevMeasurement("virtualGrid.rowShellCreated");
		rowsInMountedRange.push({
			key: rowIndex,
			physicalRowSlot,
			rowIndex,
			top: row.top,
			bindings,
		});
	}

	const rowsByPhysicalSlot = orderRowsBySlotIndex(rowsInMountedRange);
	assertMountedGridRows({
		rows: rowsByPhysicalSlot,
		slotCapacity: rowSlotAllocator.capacity,
		columns,
	});

	return {
		get cells() {
			if (flattenedCells) return flattenedCells;
			flattenedCells = [];
			for (const row of rowsInMountedRange) {
				for (const binding of row.bindings) {
					if (binding) flattenedCells.push(binding);
				}
			}
			return flattenedCells;
		},
		rowsInMountedRange,
		rowsByPhysicalSlot,
	};
}

/** Orders resident rows by physical slot in O(resident rows) without sorting. */
function orderRowsBySlotIndex<TCell extends MountedVirtualCell>(
	rows: readonly MountedGridRow<TCell>[],
): MountedGridRow<TCell>[] {
	const rowsByPhysicalSlot: (MountedGridRow<TCell> | undefined)[] = [];
	for (const row of rows) rowsByPhysicalSlot[row.physicalRowSlot] = row;

	let writeIndex = 0;
	for (let readIndex = 0; readIndex < rowsByPhysicalSlot.length; readIndex += 1) {
		const row = rowsByPhysicalSlot[readIndex];
		if (row === undefined) continue;
		rowsByPhysicalSlot[writeIndex] = row;
		writeIndex += 1;
	}
	rowsByPhysicalSlot.length = writeIndex;
	return rowsByPhysicalSlot as MountedGridRow<TCell>[];
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
			row.physicalRowSlot < 0 ||
			row.physicalRowSlot >= params.slotCapacity ||
			rowSlots.has(row.physicalRowSlot)
		) {
			throw new Error(
				`Invalid or duplicate mounted row slot: ${row.physicalRowSlot}.`,
			);
		}
		if (row.bindings.length !== params.columns) {
			throw new Error(
				`Mounted row ${row.rowIndex} has ${row.bindings.length} bindings; expected ${params.columns}.`,
			);
		}
		logicalRows.add(row.rowIndex);
		rowSlots.add(row.physicalRowSlot);

		for (let columnIndex = 0; columnIndex < row.bindings.length; columnIndex += 1) {
			const binding = row.bindings[columnIndex];
			if (!binding) continue;
			const expectedSlotIndex =
				row.physicalRowSlot * params.columns + columnIndex;
			if (binding.physicalCellSlot !== expectedSlotIndex) {
				throw new Error(
					`Mounted cell render slot ${binding.physicalCellSlot} does not match physical slot ${expectedSlotIndex}.`,
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
