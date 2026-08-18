import type { MountedVirtualCellsBuild } from "ui/virtualization/core/virtualListEngine";
import {
	buildMountedSectionedGridRows,
	type SectionedGridMountedCellSlot,
} from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";
import type { ResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import type { RenderBodyKey } from "ui/virtualization/renderRevision";
import type { RowRange } from "ui/virtualization/rowRange";
import {
	logicalCellKey,
	type LogicalCellKey,
	type MountedVirtualCell,
} from "ui/virtualization/types";
import type {
	TwoHopRowModel,
	TwoHopVirtualCell,
} from "features/two-hop/ui/twoHopRowModel";
import {
	markCCLDevPerformance,
	recordCCLDevMeasurement,
} from "infrastructure/debug/CCLDevMeasurements";

export interface MountedTwoHopCell extends MountedVirtualCell {
	readonly key: LogicalCellKey;
	readonly columnIndex: number;
	readonly cell: TwoHopVirtualCell;
	readonly renderBodyKey: RenderBodyKey;
}

export interface MountedTwoHopRow {
	readonly key: number;
	readonly slotIndex: number;
	readonly rowIndex: number;
	readonly top: number;
	readonly cells: readonly MountedTwoHopCell[];
	readonly cellSlots: readonly SectionedGridMountedCellSlot<MountedTwoHopCell>[];
}

export interface MountedTwoHopBuild extends MountedVirtualCellsBuild<MountedTwoHopCell> {
	readonly rowSlices: readonly MountedTwoHopRow[];
	readonly rowsBySlot: readonly MountedTwoHopRow[];
	readonly poolCapacity: number;
	readonly rowModel: TwoHopRowModel;
}

export interface BuildMountedTwoHopRowsParams {
	readonly rowModel: TwoHopRowModel;
	readonly rowRange: RowRange;
	readonly rowSlotAllocator: ResidentRowSlotAllocator;
	readonly previousBuild?: MountedTwoHopBuild;
}

/** Builds only the resident two-hop rows while reusing shared physical slots. */
export function buildMountedTwoHopRows(
	params: BuildMountedTwoHopRowsParams,
): MountedTwoHopBuild {
	markCCLDevPerformance("ccl:range-build-start");
	const { rowModel, rowSlotAllocator } = params;
	const columns = rowModel.layout.columns;
	rowSlotAllocator.prepareRange({
		start: params.rowRange.start,
		end: params.rowRange.end,
		slotTopologyRevision: columns,
	});
	// rowSlices stay in ascending contiguous rowIndex order, so an overlapping
	// previous row resolves with one direct lookup instead of a resident-wide Map.
	const previousRowSlices = params.previousBuild?.rowSlices;
	const previousFirstRowIndex = previousRowSlices?.[0]?.rowIndex ?? 0;
	const canReuseRows = params.previousBuild?.rowModel === rowModel;

	const mountedRows = buildMountedSectionedGridRows<
		MountedTwoHopCell,
		MountedTwoHopRow,
		ReturnType<TwoHopRowModel["getRow"]> extends infer TRow
			? Exclude<TRow, null>
			: never
	>({
		rowRange: params.rowRange,
		columns,
		slotCapacity: rowSlotAllocator.capacity,
		resolveSlotIndex: (rowIndex) => rowSlotAllocator.resolveSlotIndex(rowIndex),
		resolvePreviousRow: (rowIndex) => {
			const previousRow = previousRowSlices?.[rowIndex - previousFirstRowIndex];
			return previousRow?.rowIndex === rowIndex ? previousRow : undefined;
		},
		canReusePreviousRow: () => canReuseRows,
		resolveRow: (rowIndex) => {
			const row = rowModel.getRow(rowIndex);
			if (!row) return null;
			return {
				top: row.top,
				columnStart: 0,
				columnEnd: row.cellCount,
				metadata: row,
			};
		},
		resolveCell: ({ columnIndex, renderSlotIndex, row }) =>
			createMountedCell(row.metadata.getCell(columnIndex), renderSlotIndex),
		rebindCell: ({ columnIndex, renderSlotIndex, row }) =>
			createMountedCell(row.metadata.getCell(columnIndex), renderSlotIndex)!,
		createRow: ({ rowIndex, slotIndex, cells, cellSlots, row }) => {
			recordCCLDevMeasurement("virtualGrid.rowShellCreated");
			return {
				key: rowIndex,
				slotIndex,
				rowIndex,
				top: row.top,
				cells,
				cellSlots,
			};
		},
	});

	recordCCLDevMeasurement("virtualGrid.buildMountedRows");
	const build: MountedTwoHopBuild = {
		get cells() {
			return mountedRows.cells;
		},
		// Two-hop reuses cells only through whole-row reuse; no consumer reads this
		// map, so the lazy build below must stay off the scroll hot path.
		get reusableCellsByKey() {
			return mountedRows.reusableCellsByKey;
		},
		rowSlices: mountedRows.rowSlices,
		rowsBySlot: mountedRows.rowsBySlot,
		nextRenderSlotIndex: mountedRows.nextRenderSlotIndex,
		poolCapacity: rowSlotAllocator.capacity,
		rowModel,
	};
	markCCLDevPerformance("ccl:range-build-end");
	return build;
}

function createMountedCell(
	cell: TwoHopVirtualCell | null,
	renderSlotIndex: number,
): MountedTwoHopCell | null {
	if (!cell) return null;
	recordCCLDevMeasurement("virtualGrid.cellShellCreated");
	return {
		key: logicalCellKey(cell.logicalKey),
		renderSlotIndex,
		rowIndex: cell.rowIndex,
		columnIndex: cell.columnIndex,
		cell,
		renderBodyKey: cell.logicalKey,
	};
}
