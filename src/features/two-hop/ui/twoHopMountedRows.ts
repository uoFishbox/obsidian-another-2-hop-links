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
import {
	cellSlotIndex,
	hasSameCellSlotIncarnation,
	hasSameRowSlotLease,
	type ResidentCellSlotIncarnation,
	type ResidentRowSlotLease,
} from "ui/virtualization/core/residentSlotBinding";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";
import {
	buildMountedSectionedGridRows,
	type SectionedGridMountedCellSlot,
} from "ui/virtualization/core/reconciliation/mountedSectionedGridRows";
import {
	createResidentRowSlotAllocator,
	type ResidentRowSlotAllocator,
	type ResidentSlotPoolPublication,
} from "ui/virtualization/core/residentSlotAllocator";
import type { SectionDataRevision } from "features/two-hop/ui/twoHopRevisions";

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
	readonly occupiedRowsInSlotOrder: readonly TwoHopMountedRow[];
	readonly cellSlotCapacity: number;
}

interface TwoHopMountedCellCompilerIdentity {
	readonly publicationRevision: SectionDataRevision;
	readonly slotIncarnation: ResidentCellSlotIncarnation;
}

const compilerIdentityByCell = new WeakMap<
	TwoHopMountedCell,
	TwoHopMountedCellCompilerIdentity
>();
const slotPoolByBuild = new WeakMap<
	TwoHopMountedRowsBuild,
	ResidentSlotPoolPublication
>();
const slotLeaseByRow = new WeakMap<TwoHopMountedRow, ResidentRowSlotLease>();

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
	const allocator = params.rowSlotAllocator ?? createResidentRowSlotAllocator();
	const slotPool = allocator.prepareRange({
		start,
		end,
		slotTopologyRevision: rowModel.geometry.columns,
	});
	if (
		previousBuild?.rowModel === rowModel &&
		previousBuild.rowRange.start === start &&
		previousBuild.rowRange.end === end &&
		slotPoolByBuild.get(previousBuild) === slotPool
	) {
		return previousBuild;
	}

	const columns = rowModel.geometry.columns;
	const rowScratch = createTwoHopResolvedRowBuffer();
	const cellScratch = createTwoHopResolvedCellBuffer();
	type TwoHopResolvedMountedRow = {
		readonly section: TwoHopDocumentSection;
		readonly rowScratch: ReturnType<typeof createTwoHopResolvedRowBuffer>;
		readonly rowLease: ResidentRowSlotLease;
	};
	const mountedRows = buildMountedSectionedGridRows<
		TwoHopMountedCell,
		TwoHopMountedRow,
		TwoHopResolvedMountedRow
	>({
		rowRange: { start, end },
		columns,
		slotCapacity: allocator.capacity,
		resolveSlotLease: (rowIndex) => allocator.resolveSlotLease(rowIndex),
		resolvePreviousRow: (rowIndex) =>
			getPreviousRow(previousBuild, rowModel, rowIndex),
		canReusePreviousRow: (row) => {
			const currentLease = allocator.resolveSlotLease(row.rowIndex);
			const previousLease = slotLeaseByRow.get(row);
			return (
				currentLease !== undefined &&
				previousLease !== undefined &&
				hasSameRowSlotLease(previousLease, currentLease)
			);
		},
		resolveRow: (rowIndex) => {
			if (!resolveTwoHopRowInto(rowModel.geometry, rowIndex, rowScratch)) {
				return null;
			}
			const section = rowModel.document.sections[rowScratch.sectionIndex];
			const rowLease = allocator.resolveSlotLease(rowIndex);
			if (!section || !rowLease) return null;
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
					rowLease,
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
				logicalCell,
				section: row.metadata.section,
				rowLease: row.metadata.rowLease,
				rowIndex,
				columnIndex,
				renderSlotIndex,
			});
		},
		createRow: ({ rowIndex, slotIndex, cells, cellSlots, row }) => {
			const mountedRow: TwoHopMountedRow = {
				key: rowIndex,
				rowIndex,
				top: row.top,
				slotIndex,
				slotKey: slotIndex,
				cells,
				cellSlots,
			};
			slotLeaseByRow.set(mountedRow, row.metadata.rowLease);
			return mountedRow;
		},
	});
	const build: TwoHopMountedRowsBuild = {
		get cells() {
			return mountedRows.cells;
		},
		get reusableCellsByKey() {
			return mountedRows.reusableCellsByKey;
		},
		nextRenderSlotIndex: mountedRows.nextRenderSlotIndex,
		cellSlotCapacity: mountedRows.cellSlotCapacity,
		rowModel,
		rowRange: { start, end },
		rowSlices: mountedRows.rowSlices,
		occupiedRowsInSlotOrder: mountedRows.occupiedRowsInSlotOrder,
	};
	slotPoolByBuild.set(build, slotPool);
	return build;
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
	readonly logicalCell: TwoHopLogicalCell;
	readonly section: TwoHopDocumentSection;
	readonly rowLease: ResidentRowSlotLease;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderSlotIndex: number;
}): TwoHopMountedCell {
	const nextRenderSlotKey = renderSlotKey(params.renderSlotIndex);
	const slotIncarnation = createCellIncarnation(
		params.rowLease,
		params.renderSlotIndex,
	);

	const mountedCell: TwoHopMountedCell = {
		key: params.logicalCell.key,
		cell: params.logicalCell,
		section: params.section,
		rowIndex: params.rowIndex,
		columnIndex: params.columnIndex,
		renderSlotIndex: params.renderSlotIndex,
		renderSlotKey: nextRenderSlotKey,
		cellSlotKey: params.renderSlotIndex,
	};
	compilerIdentityByCell.set(mountedCell, {
		publicationRevision: params.section.sourceRevision,
		slotIncarnation,
	});
	return mountedCell;
}

/**
 * Reports physical slot continuity for the frame compiler without exposing the
 * allocator's generation coordinates to UI consumers.
 */
export function hasContinuousTwoHopPhysicalCellSlot(
	previous: TwoHopMountedCell,
	next: TwoHopMountedCell,
): boolean {
	const previousIdentity = compilerIdentityByCell.get(previous);
	const nextIdentity = compilerIdentityByCell.get(next);
	return (
		previousIdentity !== undefined &&
		nextIdentity !== undefined &&
		hasSameCellSlotIncarnation(
			previousIdentity.slotIncarnation,
			nextIdentity.slotIncarnation,
		)
	);
}

/**
 * Reports semantic publication continuity exclusively for the frame compiler.
 */
export function hasSameTwoHopCellPublication(
	previous: TwoHopMountedCell,
	next: TwoHopMountedCell,
): boolean {
	const previousIdentity = compilerIdentityByCell.get(previous);
	const nextIdentity = compilerIdentityByCell.get(next);
	return (
		previousIdentity !== undefined &&
		nextIdentity !== undefined &&
		previousIdentity.publicationRevision === nextIdentity.publicationRevision
	);
}

function createCellIncarnation(
	rowLease: ResidentRowSlotLease,
	renderSlotIndex: number,
): ResidentCellSlotIncarnation {
	return Object.freeze({
		rowLease,
		cellSlotIndex: cellSlotIndex(renderSlotIndex),
	});
}
