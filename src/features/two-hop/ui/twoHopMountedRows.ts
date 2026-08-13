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
	renderSlotKey,
	type LogicalCellKey,
	type MountedVirtualCell,
	type RenderSlotKey,
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
	readonly renderSlotKey: RenderSlotKey;
	readonly columnIndex: number;
	readonly cell: TwoHopVirtualCell;
	readonly renderBodyKey: RenderBodyKey;
	readonly cellSlotKey: number;
}

export interface MountedTwoHopRow {
	readonly key: number;
	readonly slotIndex: number;
	readonly slotKey: number;
	readonly rowIndex: number;
	readonly top: number;
	readonly cells: readonly MountedTwoHopCell[];
	readonly cellSlots: readonly SectionedGridMountedCellSlot<MountedTwoHopCell>[];
}

export interface MountedTwoHopBuild extends MountedVirtualCellsBuild<MountedTwoHopCell> {
	readonly rowSlices: readonly MountedTwoHopRow[];
	readonly rowsBySlot: readonly MountedTwoHopRow[];
	readonly poolCapacity: number;
	readonly poolEpoch: number;
	readonly rowModel: TwoHopRowModel;
	readonly columns: number;
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
	const slotPublication = rowSlotAllocator.prepareRange({
		start: params.rowRange.start,
		end: params.rowRange.end,
		slotTopologyRevision: columns,
	});
	const previousRowsByIndex = new Map<number, MountedTwoHopRow>();
	for (const row of params.previousBuild?.rowSlices ?? []) {
		previousRowsByIndex.set(row.rowIndex, row);
	}
	const previousCellsByKey =
		params.previousBuild?.reusableCellsByKey ??
		new Map<string, MountedTwoHopCell>();
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
		slotCapacity: slotPublication.capacity,
		resolveSlotLease: (rowIndex) => rowSlotAllocator.resolveSlotLease(rowIndex),
		resolvePreviousRow: (rowIndex) => previousRowsByIndex.get(rowIndex),
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
			createMountedCell(
				row.metadata.getCell(columnIndex),
				renderSlotIndex,
				previousCellsByKey,
			),
		rebindCell: ({ columnIndex, renderSlotIndex, row }) =>
			createMountedCell(
				row.metadata.getCell(columnIndex),
				renderSlotIndex,
				previousCellsByKey,
			)!,
		createRow: ({ rowIndex, slotIndex, cells, cellSlots, row }) => {
			recordCCLDevMeasurement("virtualGrid.rowShellCreated");
			return {
				key: rowIndex,
				slotIndex,
				slotKey: slotIndex,
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
		get reusableCellsByKey() {
			return mountedRows.reusableCellsByKey;
		},
		rowSlices: mountedRows.rowSlices,
		rowsBySlot: mountedRows.rowsBySlot,
		nextRenderSlotIndex: mountedRows.nextRenderSlotIndex,
		poolCapacity: slotPublication.capacity,
		poolEpoch: slotPublication.poolEpoch,
		rowModel,
		columns,
	};
	markCCLDevPerformance("ccl:range-build-end");
	return build;
}

function createMountedCell(
	cell: TwoHopVirtualCell | null,
	renderSlotIndex: number,
	previousCellsByKey: ReadonlyMap<string, MountedTwoHopCell>,
): MountedTwoHopCell | null {
	if (!cell) return null;
	const key = logicalCellKey(cell.logicalKey);
	const previous = previousCellsByKey.get(key);
	const nextRenderSlotKey = renderSlotKey(renderSlotIndex);
	if (
		previous?.cell === cell &&
		previous.rowIndex === cell.rowIndex &&
		previous.columnIndex === cell.columnIndex &&
		previous.renderSlotIndex === renderSlotIndex
	) {
		return previous;
	}
	recordCCLDevMeasurement("virtualGrid.cellShellCreated");
	return {
		key,
		renderSlotIndex,
		renderSlotKey: nextRenderSlotKey,
		rowIndex: cell.rowIndex,
		columnIndex: cell.columnIndex,
		cell,
		renderBodyKey: cell.logicalKey,
		cellSlotKey: renderSlotIndex,
	};
}
