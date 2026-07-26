import type { TwoHopDocumentSection } from "features/two-hop/ui/twoHopDocument";
import type {
	TwoHopLogicalCell,
	TwoHopVirtualRowModel,
} from "features/two-hop/ui/twoHopVirtualRowModel";
import { createTwoHopLogicalCell } from "features/two-hop/ui/twoHopVirtualRowModel";
import {
	createTwoHopResolvedCellBuffer,
	createTwoHopResolvedRowBuffer,
	resolveTwoHopCellInRowInto,
	resolveTwoHopRowInto,
} from "features/two-hop/ui/viewport/twoHopGeometry";
import type { MountedVirtualCellsBuild } from "ui/virtualization/core/virtualListEngine";
import type { RowRange } from "ui/virtualization/rowRange";
import { renderSlotKey, type MountedVirtualCell } from "ui/virtualization/types";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";
import {
	buildMountedSectionedGridRows,
	type SectionedGridMountedCellSlot,
} from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
} from "ui/virtualization/core/residentSlotAllocator";

export interface TwoHopMountedCell extends MountedVirtualCell {
	readonly cell: TwoHopLogicalCell;
	readonly section: TwoHopDocumentSection;
}

export interface TwoHopMountedRow extends VirtualSurfaceMountedRow<TwoHopMountedCell> {
	readonly slotIndex: number;
	readonly slotKey: number;
	readonly cells: readonly TwoHopMountedCell[];
	readonly cellSlots: readonly SectionedGridMountedCellSlot<TwoHopMountedCell>[];
}

export interface TwoHopMountedRowsBuild extends MountedVirtualCellsBuild<TwoHopMountedCell> {
	readonly rowModel: TwoHopVirtualRowModel;
	readonly rowRange: RowRange;
	readonly rowSlices: readonly TwoHopMountedRow[];
	readonly rowsBySlot: readonly TwoHopMountedRow[];
}

/** Builds bounded physical row/cell shells and exposes both slot and logical body keys. */
export function buildTwoHopMountedRows(params: {
	readonly rowModel: TwoHopVirtualRowModel;
	readonly rowRange: RowRange;
	readonly previousBuild?: TwoHopMountedRowsBuild;
	readonly rowSlotAllocator?: ResidentRowSlotAllocator;
}): TwoHopMountedRowsBuild {
	const { rowModel } = params;
	const start = Math.max(0, params.rowRange.start);
	const end = Math.min(rowModel.rowCount, params.rowRange.end);
	const previousBuild = params.previousBuild;
	// Reference equality is only a hot-path cache hit; a miss rebuilds the same
	// publication and does not participate in slot ownership validation.
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
		layoutRevision: rowModel.layoutRevision,
	});
	const columns = rowModel.geometry.columns;
	const rowScratch = createTwoHopResolvedRowBuffer();
	const cellScratch = createTwoHopResolvedCellBuffer();
	type TwoHopResolvedMountedRow = {
		readonly section: TwoHopDocumentSection;
		readonly rowScratch: ReturnType<typeof createTwoHopResolvedRowBuffer>;
	};
	const mountedRows = buildMountedSectionedGridRows<
		TwoHopMountedCell,
		TwoHopMountedRow,
		TwoHopResolvedMountedRow
	>({
		rowRange: { start, end },
		columns,
		slotCapacity: allocator.capacity,
		resolveSlotIndex: (rowIndex) => allocator.resolveSlotIndex(rowIndex),
		resolvePreviousRow: (rowIndex) =>
			getPreviousRow(previousBuild, rowModel, rowIndex),
		canReusePreviousRow: () => true,
		resolveRow: (rowIndex) => {
			if (!resolveTwoHopRowInto(rowModel.geometry, rowIndex, rowScratch)) {
				return null;
			}
			const section = rowModel.document.sections[rowScratch.sectionIndex];
			if (!section) return null;
			const sectionCellCount =
				1 + section.visibleItemCount + (section.loadMore === null ? 0 : 1);
			const rowCellCount = Math.min(
				columns,
				Math.max(0, sectionCellCount - rowScratch.rowInSection * columns),
			);
			return {
				top: rowScratch.top,
				columnStart: 0,
				columnEnd: rowCellCount,
				metadata: {
					section,
					rowScratch,
				},
			};
		},
		resolveCell: ({ rowIndex, columnIndex, renderSlotIndex, row }) => {
			const logicalCell = resolveLogicalCell({
				rowModel,
				rowScratch: row.metadata.rowScratch,
				cellScratch,
				columnIndex,
			});
			if (!logicalCell) return null;
			return resolveMountedCell({
				previous: undefined,
				logicalCell,
				section: row.metadata.section,
				rowIndex,
				columnIndex,
				renderSlotIndex,
			});
		},
		rebindCell: ({ previous, rowIndex, columnIndex, renderSlotIndex }) =>
			resolveMountedCell({
				previous,
				logicalCell: previous.cell,
				section: previous.section,
				rowIndex,
				columnIndex,
				renderSlotIndex,
			}),
		createRow: ({ rowIndex, slotIndex, cells, cellSlots, row }) => ({
			key: rowIndex,
			rowIndex,
			top: row.top,
			slotIndex,
			slotKey: slotIndex,
			cells,
			cellSlots,
		}),
	});
	return {
		get cells() {
			return mountedRows.cells;
		},
		get reusableCellsByKey() {
			return mountedRows.reusableCellsByKey;
		},
		nextRenderSlotIndex: mountedRows.nextRenderSlotIndex,
		rowModel,
		rowRange: { start, end },
		rowSlices: mountedRows.rowSlices,
		rowsBySlot: mountedRows.rowsBySlot,
	};
}

function getPreviousRow(
	previousBuild: TwoHopMountedRowsBuild | undefined,
	rowModel: TwoHopVirtualRowModel,
	rowIndex: number,
): TwoHopMountedRow | undefined {
	// Row reuse is an allocation optimization. Binding correctness is enforced
	// later by the resident slot binding token.
	if (!previousBuild || previousBuild.rowModel !== rowModel) return undefined;
	const offset = rowIndex - previousBuild.rowRange.start;
	if (offset < 0 || offset >= previousBuild.rowSlices.length) return undefined;
	const row = previousBuild.rowSlices[offset];
	return row?.rowIndex === rowIndex ? row : undefined;
}

function resolveLogicalCell(params: {
	readonly rowModel: TwoHopVirtualRowModel;
	readonly rowScratch: ReturnType<typeof createTwoHopResolvedRowBuffer>;
	readonly cellScratch: ReturnType<typeof createTwoHopResolvedCellBuffer>;
	readonly columnIndex: number;
}): TwoHopLogicalCell | null {
	const resolved = resolveTwoHopCellInRowInto(
		params.rowModel.document,
		params.rowModel.geometry,
		params.rowScratch,
		params.columnIndex,
		params.cellScratch,
	);
	return resolved ? createTwoHopLogicalCell(resolved) : null;
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
	// Reusing the shell object is optional; stale ownership is never inferred
	// from this reference identity.
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
