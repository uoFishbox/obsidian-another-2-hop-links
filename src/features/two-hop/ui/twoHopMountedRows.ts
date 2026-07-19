import type { TwoHopDocumentSection } from "features/two-hop/ui/twoHopDocument";
import type {
	TwoHopLogicalCell,
	TwoHopVirtualRowModel,
} from "features/two-hop/ui/twoHopVirtualRowModel";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "ui/virtualization/core/residentSlotAllocator";
import type { MountedVirtualCellsBuild } from "ui/virtualization/core/virtualListEngine";
import type { RowRange } from "ui/virtualization/rowRange";
import { renderSlotKey, type MountedVirtualCell } from "ui/virtualization/types";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";

export interface TwoHopMountedCell extends MountedVirtualCell {
	readonly cell: TwoHopLogicalCell;
	readonly section: TwoHopDocumentSection;
}

export interface TwoHopMountedRow extends VirtualSurfaceMountedRow<TwoHopMountedCell> {
	readonly slotIndex: number;
	readonly slotKey: number;
	readonly cells: readonly TwoHopMountedCell[];
}

export interface TwoHopMountedRowsBuild extends MountedVirtualCellsBuild<TwoHopMountedCell> {
	readonly rowModel: TwoHopVirtualRowModel;
	readonly rowRange: RowRange;
	readonly rowSlices: readonly TwoHopMountedRow[];
	readonly rowsBySlot: readonly TwoHopMountedRow[];
}

const EMPTY_PREVIOUS_CELLS: ReadonlyMap<string, TwoHopMountedCell> = new Map();

/** Builds bounded physical row/cell shells while keeping card bodies logical-keyed. */
export function buildTwoHopMountedRows(params: {
	readonly rowModel: TwoHopVirtualRowModel;
	readonly rowRange: RowRange;
	readonly previousBuild?: TwoHopMountedRowsBuild;
	readonly previousCellsByKey?: ReadonlyMap<string, TwoHopMountedCell>;
	readonly rowSlotAllocator?: ResidentRowSlotAllocator;
}): TwoHopMountedRowsBuild {
	const { rowModel } = params;
	const start = Math.max(0, params.rowRange.start);
	const end = Math.min(rowModel.rowCount, params.rowRange.end);
	const previousBuild = params.previousBuild;
	if (
		previousBuild?.rowModel === rowModel &&
		previousBuild.rowRange.start === start &&
		previousBuild.rowRange.end === end
	) {
		return previousBuild;
	}

	const allocator = params.rowSlotAllocator ?? createResidentRowSlotAllocator();
	allocator.prepareRange({
		start,
		end,
		layoutKey: `${rowModel.layout.columns}|${rowModel.layout.cellWidth}|${rowModel.layout.rowHeight}|${rowModel.layout.gap}`,
	});
	const previousCellsByKey =
		previousBuild?.reusableCellsByKey ??
		params.previousCellsByKey ??
		EMPTY_PREVIOUS_CELLS;
	const previousRowsByIndex = new Map<number, TwoHopMountedRow>();
	for (const row of previousBuild?.rowSlices ?? []) {
		previousRowsByIndex.set(row.rowIndex, row);
	}

	const rowSlices: TwoHopMountedRow[] = [];
	const reusableCellsByKey = new Map<string, TwoHopMountedCell>();
	const cells: TwoHopMountedCell[] = [];
	const columns = Math.max(1, rowModel.layout.columns);

	for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
		const row = rowModel.getRow(rowIndex);
		const section = rowModel.getDocumentSection(rowIndex);
		if (!row || !section) continue;
		const slotIndex = allocator.resolveSlotIndex(rowIndex);
		const previousRow = previousRowsByIndex.get(rowIndex);
		if (
			previousBuild?.rowModel === rowModel &&
			previousRow?.slotIndex === slotIndex
		) {
			rowSlices.push(previousRow);
			for (const cell of previousRow.cells) {
				cells.push(cell);
				reusableCellsByKey.set(cell.key, cell);
			}
			continue;
		}

		const rowCells: TwoHopMountedCell[] = [];
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			const logicalCell = row.getCell(columnIndex);
			if (!logicalCell) continue;
			const renderSlotIndex = slotIndex * columns + columnIndex;
			const previous = previousCellsByKey.get(logicalCell.key);
			const mountedCell = resolveMountedCell({
				previous,
				logicalCell,
				section,
				rowIndex,
				columnIndex,
				renderSlotIndex,
			});
			rowCells.push(mountedCell);
			cells.push(mountedCell);
			reusableCellsByKey.set(mountedCell.key, mountedCell);
		}

		rowSlices.push({
			key: rowIndex,
			rowIndex,
			top: row.top,
			slotIndex,
			slotKey: slotIndex,
			cells: rowCells,
		});
	}

	const rowsBySlot = [...rowSlices].sort(
		(current, next) => current.slotIndex - next.slotIndex,
	);
	return {
		cells,
		reusableCellsByKey,
		nextRenderSlotIndex: allocator.capacity * columns,
		rowModel,
		rowRange: { start, end },
		rowSlices,
		rowsBySlot,
	};
}

function resolveMountedCell(params: {
	readonly previous: TwoHopMountedCell | undefined;
	readonly logicalCell: TwoHopLogicalCell;
	readonly section: TwoHopDocumentSection;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderSlotIndex: number;
}): TwoHopMountedCell {
	const nextRenderSlotKey = renderSlotKey(params.renderSlotIndex);
	if (
		params.previous &&
		params.previous.cell === params.logicalCell &&
		params.previous.section === params.section &&
		params.previous.rowIndex === params.rowIndex &&
		params.previous.columnIndex === params.columnIndex &&
		params.previous.renderSlotIndex === params.renderSlotIndex &&
		params.previous.renderSlotKey === nextRenderSlotKey
	) {
		return params.previous;
	}

	return {
		key: params.logicalCell.key,
		cell: params.logicalCell,
		section: params.section,
		rowIndex: params.rowIndex,
		columnIndex: params.columnIndex,
		renderSlotIndex: params.renderSlotIndex,
		renderSlotKey: nextRenderSlotKey,
		cellSlotKey: params.renderSlotIndex,
		// The outer shell is physical-slot keyed; only the body follows this key.
		renderBodyKey: String(params.logicalCell.key),
	};
}
