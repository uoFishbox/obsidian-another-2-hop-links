import type { FlatGridLogicalCell } from "./logicalCell";
import {
	buildMountedGridRows,
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
}

function createMountedFlatGridCell<T>(
	cell: FlatGridLogicalCell<T>,
	physicalCellSlot: number,
	rowIndex: number,
	columnIndex: number,
): MountedFlatGridCell<T> {
	return {
		key: cell.key,
		physicalCellSlot,
		rowIndex,
		columnIndex,
		cell,
	};
}

export interface BuildMountedFlatGridRowsParams<T> {
	readonly rowModel: FlatGridRowModel<T>;
	readonly rowRange: RowRange;
	readonly previousBuild?: MountedFlatGridBuild<T>;
	readonly rowSlotAllocator: ResidentRowSlotAllocator;
}

/** Builds flat rows, retaining existing row bindings only for the same model. */
export function buildMountedFlatGridRows<T>(
	params: BuildMountedFlatGridRowsParams<T>,
): MountedFlatGridBuild<T> {
	const { rowModel, rowSlotAllocator } = params;
	const previousBuild = params.previousBuild;
	const rowsInMountedRange = buildMountedGridRows<
		FlatGridLogicalCell<T>,
		MountedFlatGridCell<T>
	>({
		rowModel,
		rowRange: params.rowRange,
		rowSlotAllocator,
		previousRows:
			previousBuild?.rowModel === rowModel
				? previousBuild.rowsInMountedRange
				: undefined,
		bindCell: createMountedFlatGridCell,
	});

	return {
		rowsInMountedRange,
		rowModel,
		slotBindingRevision: rowModel.cellSource.slotBindingRevision,
	};
}
