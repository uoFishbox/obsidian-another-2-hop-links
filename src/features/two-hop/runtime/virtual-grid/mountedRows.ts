import type { MountedVirtualCellsBuild } from "ui/virtualization/public";
import { buildMountedGridRows, type MountedGridRow } from "ui/virtualization/public";
import type { ResidentRowSlotAllocator } from "ui/virtualization/public";
import type { RowRange } from "ui/virtualization/public";
import {
	logicalCellKey,
	type LogicalCellKey,
	type MountedVirtualCell,
} from "ui/virtualization/public";
import type { TwoHopRowModel, TwoHopVirtualCell } from "./rowModel";
import {
	markCCLDevPerformance,
	recordCCLDevMeasurement,
} from "infrastructure/debug/CCLDevMeasurements";

export interface MountedTwoHopCell extends MountedVirtualCell {
	readonly key: LogicalCellKey;
	readonly columnIndex: number;
	readonly cell: TwoHopVirtualCell;
}

export type MountedTwoHopRow = MountedGridRow<MountedTwoHopCell>;

export interface MountedTwoHopBuild extends MountedVirtualCellsBuild<MountedTwoHopCell> {
	readonly rowsInMountedRange: readonly MountedTwoHopRow[];
	readonly rowsByPhysicalSlot: readonly MountedTwoHopRow[];
	readonly poolCapacity: number;
	readonly rowModel: TwoHopRowModel;
}

export interface BuildMountedTwoHopRowsParams {
	readonly rowModel: TwoHopRowModel;
	readonly rowRange: RowRange;
	readonly rowSlotAllocator: ResidentRowSlotAllocator;
	readonly previousBuild?: MountedTwoHopBuild;
}

/** Builds resident two-hop rows while reusing shared physical slots. */
export function buildMountedTwoHopRows(
	params: BuildMountedTwoHopRowsParams,
): MountedTwoHopBuild {
	markCCLDevPerformance("ccl:range-build-start");
	const { rowModel, rowSlotAllocator } = params;
	const mountedRows = buildMountedGridRows<TwoHopVirtualCell, MountedTwoHopCell>({
		rowModel,
		rowRange: params.rowRange,
		rowSlotAllocator,
		previousRows: params.previousBuild?.rowsInMountedRange,
		canReusePreviousRows: params.previousBuild?.rowModel === rowModel,
		bindCell: ({ cell, physicalCellSlot }) =>
			createMountedCell(cell, physicalCellSlot),
	});

	recordCCLDevMeasurement("virtualGrid.buildMountedRows");
	const build: MountedTwoHopBuild = {
		get cells() {
			return mountedRows.cells;
		},
		rowsInMountedRange: mountedRows.rowsInMountedRange,
		rowsByPhysicalSlot: mountedRows.rowsByPhysicalSlot,
		poolCapacity: rowSlotAllocator.capacity,
		rowModel,
	};
	markCCLDevPerformance("ccl:range-build-end");
	return build;
}

function createMountedCell(
	cell: TwoHopVirtualCell,
	physicalCellSlot: number,
): MountedTwoHopCell {
	recordCCLDevMeasurement("virtualGrid.cellShellCreated");
	return {
		key: logicalCellKey(cell.logicalKey),
		physicalCellSlot,
		rowIndex: cell.rowIndex,
		columnIndex: cell.columnIndex,
		cell,
	};
}
