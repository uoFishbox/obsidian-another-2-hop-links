import type { RowRange } from "ui/virtualization/rowRange";
import { renderSlotKey, type RenderSlotKey } from "ui/virtualization/types";
import type { ResidentRowSlotLease } from "ui/virtualization/core/residentSlotBinding";

export interface SectionedGridMountedCell {
	readonly key: string;
	readonly columnIndex?: number;
	readonly renderSlotIndex: number;
}

/**
 * One stable physical column slot whose logical binding may be empty.
 */
export interface SectionedGridMountedCellSlot<TCell extends SectionedGridMountedCell> {
	readonly renderSlotIndex: number;
	readonly renderSlotKey: RenderSlotKey;
	readonly columnIndex: number;
	readonly binding: TCell | null;
}

export interface SectionedGridMountedRow<TCell extends SectionedGridMountedCell> {
	readonly rowIndex: number;
	readonly slotIndex: number;
	readonly cells: readonly TCell[];
	readonly cellSlots: readonly SectionedGridMountedCellSlot<TCell>[];
}

export interface ResolvedSectionedGridRow<TRowMetadata> {
	readonly top: number;
	readonly columnStart: number;
	readonly columnEnd: number;
	readonly metadata: TRowMetadata;
}

export interface MountedSectionedGridRows<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
> {
	readonly cells: TCell[];
	readonly reusableCellsByKey: Map<string, TCell>;
	readonly rowSlices: TRow[];
	readonly rowsBySlot: TRow[];
	readonly nextRenderSlotIndex: number;
}

export interface BuildMountedSectionedGridRowsParams<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
	TRowMetadata,
> {
	readonly rowRange: RowRange;
	readonly columns: number;
	readonly slotCapacity: number;
	resolveSlotLease(rowIndex: number): ResidentRowSlotLease | undefined;
	resolvePreviousRow(rowIndex: number): TRow | undefined;
	canReusePreviousRow(row: TRow): boolean;
	resolveRow(rowIndex: number): ResolvedSectionedGridRow<TRowMetadata> | null;
	resolveCell(params: {
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TCell | null;
	rebindCell?(params: {
		readonly previous: TCell;
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TCell;
	createRow(params: {
		readonly rowIndex: number;
		readonly slotIndex: number;
		readonly cells: TCell[];
		readonly cellSlots: SectionedGridMountedCellSlot<TCell>[];
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TRow;
}

/**
 * Builds the shared physical row/cell shells for section-aware virtual grids.
 *
 * Logical row and cell resolution stays with the caller. This function owns the
 * physical-slot invariants and the derived row/cell indexes used by renderers.
 */
export function buildMountedSectionedGridRows<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
	TRowMetadata,
>(
	params: BuildMountedSectionedGridRowsParams<TCell, TRow, TRowMetadata>,
): MountedSectionedGridRows<TCell, TRow> {
	const columns = Math.max(1, params.columns);
	const rowSlices: TRow[] = [];
	let flattenedCells: TCell[] | undefined;
	let reusableCellsByKey: Map<string, TCell> | undefined;

	for (
		let rowIndex = params.rowRange.start;
		rowIndex < params.rowRange.end;
		rowIndex += 1
	) {
		const slotLease = params.resolveSlotLease(rowIndex);
		if (!slotLease) {
			throw new Error(`No resident slot assigned for row ${rowIndex}.`);
		}
		const slotIndex = slotLease.rowSlotIndex;
		const previousRow = params.resolvePreviousRow(rowIndex);
		const canReusePreviousRow =
			previousRow !== undefined && params.canReusePreviousRow(previousRow);
		if (canReusePreviousRow && previousRow.slotIndex === slotIndex) {
			rowSlices.push(previousRow);
			continue;
		}

		const row = params.resolveRow(rowIndex);
		if (!row) continue;
		const mountedCellSlots =
			canReusePreviousRow &&
			params.rebindCell &&
			hasMatchingCellSlots(previousRow, columns)
				? rebindPreviousCellSlots({
						previousRow,
						row,
						rowIndex,
						slotIndex,
						columns,
						rebindCell: params.rebindCell,
						resolveCell: params.resolveCell,
					})
				: resolveMountedCellSlots({
						row,
						rowIndex,
						slotIndex,
						columns,
						resolveCell: params.resolveCell,
					});
		const rowCells = collectBoundCells(mountedCellSlots);

		rowSlices.push(
			params.createRow({
				rowIndex,
				slotIndex,
				cells: rowCells,
				cellSlots: mountedCellSlots,
				row,
			}),
		);
	}

	const rowsBySlot = [...rowSlices].sort(
		(left, right) => left.slotIndex - right.slotIndex,
	);
	assertMountedSectionedGridRows({
		rows: rowsBySlot,
		slotCapacity: params.slotCapacity,
		columns,
	});

	const getCells = (): TCell[] => {
		if (flattenedCells) return flattenedCells;
		flattenedCells = [];
		for (const row of rowSlices) flattenedCells.push(...row.cells);
		return flattenedCells;
	};
	const getReusableCellsByKey = (): Map<string, TCell> => {
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
		rowSlices,
		rowsBySlot,
		nextRenderSlotIndex: params.slotCapacity * columns,
	};
}

function assertMountedSectionedGridRows<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
>(params: {
	readonly rows: readonly TRow[];
	readonly slotCapacity: number;
	readonly columns: number;
}): void {
	if (process.env.NODE_ENV === "production") return;

	const logicalRows = new Set<number>();
	const rowSlots = new Set<number>();
	const cellSlots = new Set<number>();
	for (const row of params.rows) {
		if (logicalRows.has(row.rowIndex)) {
			throw new Error(`Duplicate mounted logical row: ${row.rowIndex}.`);
		}
		if (
			row.slotIndex < 0 ||
			row.slotIndex >= params.slotCapacity ||
			rowSlots.has(row.slotIndex)
		) {
			throw new Error(`Invalid or duplicate mounted row slot: ${row.slotIndex}.`);
		}
		logicalRows.add(row.rowIndex);
		rowSlots.add(row.slotIndex);

		for (const cellSlot of row.cellSlots) {
			const expectedSlotIndex =
				row.slotIndex * params.columns + cellSlot.columnIndex;
			if (
				cellSlot.renderSlotIndex !== expectedSlotIndex ||
				cellSlot.renderSlotIndex < 0 ||
				cellSlot.renderSlotIndex >= params.slotCapacity * params.columns ||
				cellSlots.has(cellSlot.renderSlotIndex)
			) {
				throw new Error(
					`Invalid or duplicate mounted cell slot: ${cellSlot.renderSlotIndex}.`,
				);
			}
			cellSlots.add(cellSlot.renderSlotIndex);
		}
	}
}

function hasMatchingCellSlots<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
>(previousRow: TRow, columns: number): boolean {
	if (previousRow.cellSlots.length !== columns) return false;
	for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
		if (previousRow.cellSlots[columnIndex]?.columnIndex !== columnIndex) {
			return false;
		}
	}
	return true;
}

function rebindPreviousCellSlots<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
	TRowMetadata,
>(params: {
	readonly previousRow: TRow;
	readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	readonly rowIndex: number;
	readonly slotIndex: number;
	readonly columns: number;
	rebindCell(params: {
		readonly previous: TCell;
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TCell;
	resolveCell(params: {
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TCell | null;
}): SectionedGridMountedCellSlot<TCell>[] {
	const cellSlots: SectionedGridMountedCellSlot<TCell>[] = [];
	for (let columnIndex = 0; columnIndex < params.columns; columnIndex += 1) {
		const renderSlotIndex = params.slotIndex * params.columns + columnIndex;
		const previousBinding =
			params.previousRow.cellSlots[columnIndex]?.binding ?? null;
		const isOccupied =
			columnIndex >= params.row.columnStart && columnIndex < params.row.columnEnd;
		const binding = !isOccupied
			? null
			: previousBinding
				? params.rebindCell({
						previous: previousBinding,
						rowIndex: params.rowIndex,
						columnIndex,
						renderSlotIndex,
						row: params.row,
					})
				: params.resolveCell({
						rowIndex: params.rowIndex,
						columnIndex,
						renderSlotIndex,
						row: params.row,
					});
		cellSlots.push(
			createMountedCellSlot({
				columnIndex,
				renderSlotIndex,
				binding,
			}),
		);
	}
	return cellSlots;
}

function resolveMountedCellSlots<
	TCell extends SectionedGridMountedCell,
	TRowMetadata,
>(params: {
	readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	readonly rowIndex: number;
	readonly slotIndex: number;
	readonly columns: number;
	resolveCell(params: {
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TCell | null;
}): SectionedGridMountedCellSlot<TCell>[] {
	const cellSlots: SectionedGridMountedCellSlot<TCell>[] = [];
	for (let columnIndex = 0; columnIndex < params.columns; columnIndex += 1) {
		const renderSlotIndex = params.slotIndex * params.columns + columnIndex;
		const binding =
			columnIndex >= params.row.columnStart && columnIndex < params.row.columnEnd
				? params.resolveCell({
						rowIndex: params.rowIndex,
						columnIndex,
						renderSlotIndex,
						row: params.row,
					})
				: null;
		cellSlots.push(
			createMountedCellSlot({
				columnIndex,
				renderSlotIndex,
				binding,
			}),
		);
	}
	return cellSlots;
}

function createMountedCellSlot<TCell extends SectionedGridMountedCell>(params: {
	readonly columnIndex: number;
	readonly renderSlotIndex: number;
	readonly binding: TCell | null;
}): SectionedGridMountedCellSlot<TCell> {
	return {
		columnIndex: params.columnIndex,
		renderSlotIndex: params.renderSlotIndex,
		renderSlotKey: renderSlotKey(params.renderSlotIndex),
		binding: params.binding,
	};
}

function collectBoundCells<TCell extends SectionedGridMountedCell>(
	cellSlots: readonly SectionedGridMountedCellSlot<TCell>[],
): TCell[] {
	const cells: TCell[] = [];
	for (const cellSlot of cellSlots) {
		if (cellSlot.binding) cells.push(cellSlot.binding);
	}
	return cells;
}
