import type { FlatGridLogicalCell } from "./logicalCell";
import {
	buildMountedGridRows,
	logicalCellKey,
	type LogicalCellKey,
	type MountedGridRow,
	type ResidentRowSlotAllocator,
	type RowRange,
} from "cards/virtualization/public";
import type { FlatGridRowModel } from "./rowModel";

export interface MountedFlatGridCell<T> {
	readonly key: LogicalCellKey;
	readonly physicalCellSlot: number;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly cell: FlatGridLogicalCell<T>;
	readonly cellIndex: number;
}

export type MountedFlatGridRow<T> = MountedGridRow<MountedFlatGridCell<T>>;

export interface MountedFlatGridBuild<T> {
	readonly rowsInMountedRange: MountedFlatGridRow<T>[];
	readonly rowModel: FlatGridRowModel<T>;
	/**
	 * Binding-topology revision captured by the same mounted-build commit as
	 * `rowsInMountedRange`. Consumers that key physical cell bodies must use this
	 * committed value rather than the eagerly derived logical-source revision.
	 */
	readonly slotBindingRevision: unknown;
	readonly columns: number;
}

const createMountedFlatGridCell = <T>(params: {
	cell: FlatGridLogicalCell<T>;
	cellIndex: number;
	rowIndex: number;
	physicalCellSlot: number;
	columnIndex: number;
}): MountedFlatGridCell<T> => {
	return {
		key: logicalCellKey(params.cell.key),
		physicalCellSlot: params.physicalCellSlot,
		rowIndex: params.rowIndex,
		columnIndex: params.columnIndex,
		cell: params.cell,
		cellIndex: params.cellIndex,
	};
};

const hasCompatibleFlatGridRowSlots = <T>(
	previousBuild: MountedFlatGridBuild<T> | undefined,
	columns: number,
): previousBuild is MountedFlatGridBuild<T> =>
	previousBuild !== undefined && previousBuild.columns === columns;

export interface BuildMountedFlatGridRowsParams<T> {
	readonly rowModel: FlatGridRowModel<T>;
	readonly rowRange: RowRange;
	readonly previousBuild?: MountedFlatGridBuild<T>;
	readonly rowSlotAllocator: ResidentRowSlotAllocator;
}

export function buildMountedFlatGridRows<T>(
	params: BuildMountedFlatGridRowsParams<T>,
): MountedFlatGridBuild<T> {
	const { rowModel } = params;
	const columns = Math.max(1, rowModel.layout.columns);
	const previousBuild = params.previousBuild;
	const canReusePreviousRows = previousBuild?.rowModel === rowModel;
	const hasCompatiblePreviousRowSlots = hasCompatibleFlatGridRowSlots(
		previousBuild,
		columns,
	);
	const { rowSlotAllocator } = params;
	const mountedRows = buildMountedGridRows<
		FlatGridLogicalCell<T>,
		MountedFlatGridCell<T>
	>({
		rowModel,
		rowRange: params.rowRange,
		rowSlotAllocator,
		previousRows: hasCompatiblePreviousRowSlots
			? previousBuild?.rowsInMountedRange
			: undefined,
		canReusePreviousRows,
		bindCell: ({ cell, rowIndex, columnIndex, physicalCellSlot }) =>
			createMountedFlatGridCell({
				cell,
				cellIndex: rowModel.getCellIndex(rowIndex, columnIndex),
				rowIndex,
				columnIndex,
				physicalCellSlot,
			}),
	});

	const buildState: MountedFlatGridBuild<T> = {
		rowsInMountedRange: mountedRows.rowsInMountedRange,
		rowModel,
		slotBindingRevision: rowModel.cellSource.slotBindingRevision,
		columns,
	};
	return buildState;
}
