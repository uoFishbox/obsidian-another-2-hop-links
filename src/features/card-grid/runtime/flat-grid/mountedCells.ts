import type { FlatGridLogicalCell } from "./logicalCell";
import {
	buildMountedGridRows,
	clampRange,
	logicalCellKey,
	type LogicalCellKey,
	type MountedGridRow,
	type ResidentRowSlotAllocator,
	type RowRange,
} from "ui/virtualization/public";
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
	readonly cells: MountedFlatGridCell<T>[];
	readonly rowsInMountedRange: MountedFlatGridRow<T>[];
	readonly rowsByPhysicalSlot: MountedFlatGridRow<T>[];
	readonly poolCapacity: number;
	readonly cellSourceRevision: unknown;
	/**
	 * Binding-topology revision captured by the same mounted-build commit as
	 * `rowsByPhysicalSlot`. Consumers that key physical cell bodies must use this
	 * committed value rather than the eagerly derived logical-source revision.
	 */
	readonly slotBindingRevision: unknown;
	readonly columns: number;
	readonly cellWidth: number;
	readonly rowHeight: number;
	readonly gap: number;
}

const createMountedFlatGridCell = <T>(params: {
	key: LogicalCellKey;
	cell: FlatGridLogicalCell<T>;
	cellIndex: number;
	rowIndex: number;
	physicalCellSlot: number;
	columnIndex: number;
}): MountedFlatGridCell<T> => {
	return {
		key: params.key,
		physicalCellSlot: params.physicalCellSlot,
		rowIndex: params.rowIndex,
		columnIndex: params.columnIndex,
		cell: params.cell,
		cellIndex: params.cellIndex,
	};
};

function isSameLogicalCellForMountedReuse<T>(
	previous: FlatGridLogicalCell<T>,
	next: FlatGridLogicalCell<T>,
): boolean {
	if (previous.kind !== next.kind || previous.key !== next.key) {
		return false;
	}

	if (previous.kind === "item" && next.kind === "item") {
		return previous.itemIndex === next.itemIndex && previous.item === next.item;
	}

	return true;
}

function canReuseMountedFlatGridCellView<T>(
	previous: MountedFlatGridCell<T>,
	logicalKey: LogicalCellKey,
	cell: FlatGridLogicalCell<T>,
	cellIndex: number,
	rowIndex: number,
	columnIndex: number,
	physicalCellSlot: number,
): boolean {
	return (
		previous.key === logicalKey &&
		isSameLogicalCellForMountedReuse(previous.cell, cell) &&
		previous.cellIndex === cellIndex &&
		previous.rowIndex === rowIndex &&
		previous.columnIndex === columnIndex &&
		previous.physicalCellSlot === physicalCellSlot
	);
}

function updateMountedFlatGridCell<T>(
	previous: MountedFlatGridCell<T>,
	logicalKey: LogicalCellKey,
	cell: FlatGridLogicalCell<T>,
	cellIndex: number,
	rowIndex: number,
	columnIndex: number,
	physicalCellSlot: number,
): MountedFlatGridCell<T> {
	return {
		...previous,
		key: logicalKey,
		cell,
		cellIndex,
		rowIndex,
		columnIndex,
		physicalCellSlot,
	};
}

function resolveMountedFlatGridCell<T>(params: {
	previous?: MountedFlatGridCell<T>;
	cell: FlatGridLogicalCell<T>;
	cellIndex: number;
	rowIndex: number;
	columnIndex: number;
	physicalCellSlot: number;
}): MountedFlatGridCell<T> {
	const cell = params.cell;
	const cellIndex = params.cellIndex;
	const key = logicalCellKey(cell.key);
	if (params.previous) {
		if (
			canReuseMountedFlatGridCellView(
				params.previous,
				key,
				cell,
				cellIndex,
				params.rowIndex,
				params.columnIndex,
				params.physicalCellSlot,
			)
		) {
			return params.previous;
		}

		return updateMountedFlatGridCell(
			params.previous,
			key,
			cell,
			cellIndex,
			params.rowIndex,
			params.columnIndex,
			params.physicalCellSlot,
		);
	}

	return createMountedFlatGridCell({
		key,
		cell,
		cellIndex,
		rowIndex: params.rowIndex,
		physicalCellSlot: params.physicalCellSlot,
		columnIndex: params.columnIndex,
	});
}

const hasCompatibleMountedFlatGridCellsBuild = <T>(
	previousBuild: MountedFlatGridBuild<T> | undefined,
	params: {
		cellSourceRevision: unknown;
		columns: number;
		cellWidth: number;
		rowHeight: number;
		gap: number;
	},
): previousBuild is MountedFlatGridBuild<T> =>
	previousBuild !== undefined &&
	Object.is(previousBuild.cellSourceRevision, params.cellSourceRevision) &&
	previousBuild.columns === params.columns &&
	previousBuild.cellWidth === params.cellWidth &&
	previousBuild.rowHeight === params.rowHeight &&
	previousBuild.gap === params.gap;

const hasCompatibleMountedVirtualGridRowSlots = <T>(
	previousBuild: MountedFlatGridBuild<T> | undefined,
	params: {
		columns: number;
		cellWidth: number;
		rowHeight: number;
		gap: number;
	},
): previousBuild is MountedFlatGridBuild<T> =>
	previousBuild !== undefined &&
	previousBuild.columns === params.columns &&
	previousBuild.cellWidth === params.cellWidth &&
	previousBuild.rowHeight === params.rowHeight &&
	previousBuild.gap === params.gap;

const hasSameMountedVirtualGridRowRange = <T>(
	build: MountedFlatGridBuild<T>,
	rowRange: RowRange,
): boolean => {
	const rows = build.rowsInMountedRange;
	if (rowRange.start >= rowRange.end) return rows.length === 0;
	return (
		rows.length === rowRange.end - rowRange.start &&
		rows[0]?.rowIndex === rowRange.start &&
		rows[rows.length - 1]?.rowIndex === rowRange.end - 1
	);
};

const assertMountedVirtualGridBuildInvariants = <T>(
	build: MountedFlatGridBuild<T>,
): void => {
	if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
		return;
	}

	const physicalCellSlots = new Set<number>();
	const logicalKeys = new Set<string>();
	for (const row of build.rowsInMountedRange) {
		for (let columnIndex = 0; columnIndex < row.bindings.length; columnIndex += 1) {
			const cell = row.bindings[columnIndex];
			if (!cell) continue;
			if (physicalCellSlots.has(cell.physicalCellSlot)) {
				throw new Error(
					`Duplicate virtual-grid render slot index: ${cell.physicalCellSlot}.`,
				);
			}
			if (logicalKeys.has(cell.key)) {
				throw new Error(
					`Duplicate virtual-grid logical cell key: ${cell.key}.`,
				);
			}
			if (cell.rowIndex !== row.rowIndex) {
				throw new Error(
					`Virtual-grid row contains a cell from another row: ${cell.key}.`,
				);
			}
			if (
				cell.columnIndex !== columnIndex ||
				cell.physicalCellSlot !==
					row.physicalRowSlot * build.columns + columnIndex
			) {
				throw new Error(
					`Virtual-grid cell render slot does not match its row slot: ${cell.key}.`,
				);
			}
			physicalCellSlots.add(cell.physicalCellSlot);
			logicalKeys.add(cell.key);
		}
	}
};

export function buildMountedFlatGridCells<T>(params: {
	rowModel: FlatGridRowModel<T>;
	rowRange: RowRange;
	previousBuild?: MountedFlatGridBuild<T>;
	rowSlotAllocator: ResidentRowSlotAllocator;
}): MountedFlatGridBuild<T> {
	const { rowModel } = params;
	const columns = Math.max(1, rowModel.layout.columns);
	const visibleRows = clampRange(params.rowRange, rowModel.rowCount);
	const previousBuild = params.previousBuild;
	const cellSourceRevision = rowModel.cellSource.revision;
	const hasCompatiblePreviousBuild = hasCompatibleMountedFlatGridCellsBuild(
		previousBuild,
		{
			cellSourceRevision,
			columns,
			cellWidth: rowModel.layout.cellWidth,
			rowHeight: rowModel.layout.rowHeight,
			gap: rowModel.layout.gap,
		},
	);
	if (
		hasCompatiblePreviousBuild &&
		hasSameMountedVirtualGridRowRange(previousBuild, visibleRows)
	) {
		return previousBuild;
	}

	const hasCompatiblePreviousRowSlots = hasCompatibleMountedVirtualGridRowSlots(
		previousBuild,
		{
			columns,
			cellWidth: rowModel.layout.cellWidth,
			rowHeight: rowModel.layout.rowHeight,
			gap: rowModel.layout.gap,
		},
	);
	const { rowSlotAllocator } = params;
	const mountedRows = buildMountedGridRows<
		FlatGridLogicalCell<T>,
		MountedFlatGridCell<T>
	>({
		rowModel,
		rowRange: visibleRows,
		rowSlotAllocator,
		previousRows: hasCompatiblePreviousRowSlots
			? previousBuild?.rowsInMountedRange
			: undefined,
		canReusePreviousRows: hasCompatiblePreviousBuild,
		bindCell: ({ cell, previous, rowIndex, columnIndex, physicalCellSlot }) =>
			resolveMountedFlatGridCell({
				cell,
				cellIndex: rowModel.getCellIndex(rowIndex, columnIndex),
				previous,
				rowIndex,
				columnIndex,
				physicalCellSlot,
			}),
	});

	const buildState: MountedFlatGridBuild<T> = {
		get cells() {
			return mountedRows.cells;
		},
		rowsInMountedRange: mountedRows.rowsInMountedRange,
		rowsByPhysicalSlot: mountedRows.rowsByPhysicalSlot,
		poolCapacity: rowSlotAllocator.capacity,
		cellSourceRevision,
		slotBindingRevision: rowModel.cellSource.slotBindingRevision,
		columns,
		cellWidth: rowModel.layout.cellWidth,
		rowHeight: rowModel.layout.rowHeight,
		gap: rowModel.layout.gap,
	};
	assertMountedVirtualGridBuildInvariants(buildState);
	return buildState;
}
