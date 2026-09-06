import {
	buildMountedGridRows,
	logicalCellKey,
	type LogicalCellKey,
	type MountedGridRow,
	type MountedVirtualCell,
	type ResidentRowSlotAllocator,
	type RowRange,
} from "cards/virtualization/public";
import type { TwoHopRowModel, TwoHopVirtualCell } from "./rowModel";

export interface MountedTwoHopCell extends MountedVirtualCell {
	readonly key: LogicalCellKey;
	readonly columnIndex: number;
	readonly cell: TwoHopVirtualCell;
}

export type MountedTwoHopRow = MountedGridRow<MountedTwoHopCell>;

export interface MountedTwoHopBuild {
	readonly rowsInMountedRange: readonly MountedTwoHopRow[];
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
	const { rowModel, rowSlotAllocator } = params;
	const rowsInMountedRange = buildMountedGridRows<
		TwoHopVirtualCell,
		MountedTwoHopCell
	>({
		rowModel,
		rowRange: params.rowRange,
		rowSlotAllocator,
		previousRows:
			params.previousBuild?.rowModel === rowModel
				? params.previousBuild.rowsInMountedRange
				: undefined,
		bindCell: createMountedTwoHopCell,
	});

	return {
		rowsInMountedRange,
		rowModel,
	};
}

function createMountedTwoHopCell(
	cell: TwoHopVirtualCell,
	physicalCellSlot: number,
): MountedTwoHopCell {
	return {
		key: logicalCellKey(cell.logicalKey),
		physicalCellSlot,
		rowIndex: cell.rowIndex,
		columnIndex: cell.columnIndex,
		cell,
	};
}
