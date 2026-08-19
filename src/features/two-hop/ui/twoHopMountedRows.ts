import type { MountedVirtualCellsBuild } from "ui/virtualization/core/virtualListEngine";
import {
	buildMountedGridRows,
	type MountedGridRow,
} from "ui/virtualization/core/reconciliation/mountedGridRows";
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

export type MountedTwoHopRow = MountedGridRow<MountedTwoHopCell>;

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
	const mountedRows = buildMountedGridRows<TwoHopVirtualCell, MountedTwoHopCell>({
		rowModel,
		rowRange: params.rowRange,
		rowSlotAllocator,
		previousRows: params.previousBuild?.rowSlices,
		canReusePreviousRows: params.previousBuild?.rowModel === rowModel,
		bindCell: ({ cell, renderSlotIndex }) =>
			createMountedCell(cell, renderSlotIndex),
	});

	recordCCLDevMeasurement("virtualGrid.buildMountedRows");
	const build: MountedTwoHopBuild = {
		get cells() {
			return mountedRows.cells;
		},
		rowSlices: mountedRows.rowSlices,
		rowsBySlot: mountedRows.rowsBySlot,
		poolCapacity: rowSlotAllocator.capacity,
		rowModel,
	};
	markCCLDevPerformance("ccl:range-build-end");
	return build;
}

function createMountedCell(
	cell: TwoHopVirtualCell,
	renderSlotIndex: number,
): MountedTwoHopCell {
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
