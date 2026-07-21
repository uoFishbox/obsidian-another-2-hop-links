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
import { createTwoHopResidentRowSlotAllocator } from "features/two-hop/ui/twoHopResidentRowSlotAllocator";
import type { ResidentRowSlotAllocator } from "ui/virtualization/core/residentSlotAllocator";
import type { MountedVirtualCellsBuild } from "ui/virtualization/core/virtualListEngine";
import type { RowRange } from "ui/virtualization/rowRange";
import { renderSlotKey, type MountedVirtualCell } from "ui/virtualization/types";
import type { VirtualSurfaceMountedRow } from "ui/virtualization/svelte/VirtualSurfaceTypes";

export interface TwoHopMountedCell extends MountedVirtualCell {
	readonly cell: TwoHopLogicalCell;
	readonly section: TwoHopDocumentSection;
}

export interface TwoHopMountedRow extends VirtualSurfaceMountedRow<TwoHopMountedCell> {
	readonly slotIndex: number;
	readonly slotKey: number;
	readonly cells: readonly TwoHopMountedCell[];
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
	if (
		previousBuild?.rowModel === rowModel &&
		previousBuild.rowRange.start === start &&
		previousBuild.rowRange.end === end
	) {
		return previousBuild;
	}

	const allocator = params.rowSlotAllocator ?? createTwoHopResidentRowSlotAllocator();
	allocator.prepareRange({
		start,
		end,
		layoutKey: rowModel.residentSlotLayoutKey,
	});
	const rowSlices: TwoHopMountedRow[] = [];
	let flattenedCells: TwoHopMountedCell[] | undefined;
	let reusableCellsByKey: Map<string, TwoHopMountedCell> | undefined;
	const columns = rowModel.geometry.columns;
	const rowScratch = createTwoHopResolvedRowBuffer();
	const cellScratch = createTwoHopResolvedCellBuffer();

	for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
		const slotIndex = allocator.resolveSlotIndex(rowIndex);
		const previousRow = getPreviousRow(previousBuild, rowModel, rowIndex);
		if (previousRow?.slotIndex === slotIndex) {
			rowSlices.push(previousRow);
			continue;
		}
		if (previousRow) {
			rowSlices.push(rebindPreviousRow(previousRow, slotIndex, columns));
			continue;
		}

		if (!resolveTwoHopRowInto(rowModel.geometry, rowIndex, rowScratch)) continue;
		const section = rowModel.document.sections[rowScratch.sectionIndex];
		if (!section) continue;

		const rowCells: TwoHopMountedCell[] = [];
		const sectionCellCount =
			1 + section.visibleItemCount + (section.loadMore === null ? 0 : 1);
		const rowCellCount = Math.min(
			columns,
			Math.max(0, sectionCellCount - rowScratch.rowInSection * columns),
		);
		for (let columnIndex = 0; columnIndex < rowCellCount; columnIndex += 1) {
			const logicalCell = resolveLogicalCell({
				rowModel,
				rowScratch,
				cellScratch,
				columnIndex,
			});
			if (!logicalCell) continue;
			const renderSlotIndex = slotIndex * columns + columnIndex;
			const mountedCell = resolveMountedCell({
				previous: undefined,
				logicalCell,
				section,
				rowIndex,
				columnIndex,
				renderSlotIndex,
			});
			rowCells.push(mountedCell);
		}

		rowSlices.push({
			key: rowIndex,
			rowIndex,
			top: rowScratch.top,
			slotIndex,
			slotKey: slotIndex,
			cells: rowCells,
		});
	}

	const sparseRowsBySlot: Array<TwoHopMountedRow | undefined> = new Array(
		allocator.capacity,
	);
	for (const row of rowSlices) sparseRowsBySlot[row.slotIndex] = row;
	const rowsBySlot: TwoHopMountedRow[] = [];
	for (const row of sparseRowsBySlot) {
		if (row) rowsBySlot.push(row);
	}
	const getCells = (): TwoHopMountedCell[] => {
		if (flattenedCells) return flattenedCells;
		flattenedCells = [];
		for (const row of rowSlices) flattenedCells.push(...row.cells);
		return flattenedCells;
	};
	const getReusableCellsByKey = (): Map<string, TwoHopMountedCell> => {
		if (reusableCellsByKey) return reusableCellsByKey;
		reusableCellsByKey = new Map();
		for (const cell of getCells()) reusableCellsByKey.set(cell.key, cell);
		return reusableCellsByKey;
	};
	return {
		get cells() {
			return getCells();
		},
		get reusableCellsByKey() {
			return getReusableCellsByKey();
		},
		nextRenderSlotIndex: allocator.capacity * columns,
		rowModel,
		rowRange: { start, end },
		rowSlices,
		rowsBySlot,
	};
}

function rebindPreviousRow(
	previousRow: TwoHopMountedRow,
	slotIndex: number,
	columns: number,
): TwoHopMountedRow {
	const cells = previousRow.cells.map((previous, columnIndex) =>
		resolveMountedCell({
			previous,
			logicalCell: previous.cell,
			section: previous.section,
			rowIndex: previousRow.rowIndex,
			columnIndex,
			renderSlotIndex: slotIndex * columns + columnIndex,
		}),
	);
	return {
		key: previousRow.key,
		rowIndex: previousRow.rowIndex,
		top: previousRow.top,
		slotIndex,
		slotKey: slotIndex,
		cells,
	};
}

function getPreviousRow(
	previousBuild: TwoHopMountedRowsBuild | undefined,
	rowModel: TwoHopVirtualRowModel,
	rowIndex: number,
): TwoHopMountedRow | undefined {
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
