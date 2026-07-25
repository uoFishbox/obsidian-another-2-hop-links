import type { RowRange } from "ui/virtualization/rowRange";

export interface SectionedGridMountedCell {
	readonly key: string;
	readonly columnIndex?: number;
	readonly renderSlotIndex: number;
}

export interface SectionedGridMountedRow<TCell extends SectionedGridMountedCell> {
	readonly rowIndex: number;
	readonly slotIndex: number;
	readonly cells: readonly TCell[];
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
	resolveSlotIndex(rowIndex: number): number;
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
		const slotIndex = params.resolveSlotIndex(rowIndex);
		const previousRow = params.resolvePreviousRow(rowIndex);
		const canReusePreviousRow =
			previousRow !== undefined && params.canReusePreviousRow(previousRow);
		if (canReusePreviousRow && previousRow.slotIndex === slotIndex) {
			rowSlices.push(previousRow);
			continue;
		}

		const row = params.resolveRow(rowIndex);
		if (!row) continue;
		const rowCells =
			canReusePreviousRow &&
			params.rebindCell &&
			hasMatchingColumns(previousRow, row)
				? rebindPreviousCells({
						previousRow,
						row,
						rowIndex,
						slotIndex,
						columns,
						rebindCell: params.rebindCell,
					})
				: resolveMountedCells({
						row,
						rowIndex,
						slotIndex,
						columns,
						resolveCell: params.resolveCell,
					});

		rowSlices.push(
			params.createRow({
				rowIndex,
				slotIndex,
				cells: rowCells,
				row,
			}),
		);
	}

	const sparseRowsBySlot: Array<TRow | undefined> = new Array(params.slotCapacity);
	for (const row of rowSlices) sparseRowsBySlot[row.slotIndex] = row;
	const rowsBySlot: TRow[] = [];
	for (const row of sparseRowsBySlot) {
		if (row) rowsBySlot.push(row);
	}

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

function hasMatchingColumns<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
	TRowMetadata,
>(previousRow: TRow, row: ResolvedSectionedGridRow<TRowMetadata>): boolean {
	if (previousRow.cells.length !== row.columnEnd - row.columnStart) return false;
	for (let offset = 0; offset < previousRow.cells.length; offset += 1) {
		if (previousRow.cells[offset].columnIndex !== row.columnStart + offset) {
			return false;
		}
	}
	return true;
}

function rebindPreviousCells<
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
}): TCell[] {
	return params.previousRow.cells.map((previous, offset) => {
		const columnIndex = params.row.columnStart + offset;
		return params.rebindCell({
			previous,
			rowIndex: params.rowIndex,
			columnIndex,
			renderSlotIndex: params.slotIndex * params.columns + columnIndex,
			row: params.row,
		});
	});
}

function resolveMountedCells<
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
}): TCell[] {
	const cells: TCell[] = [];
	for (
		let columnIndex = params.row.columnStart;
		columnIndex < params.row.columnEnd;
		columnIndex += 1
	) {
		const cell = params.resolveCell({
			rowIndex: params.rowIndex,
			columnIndex,
			renderSlotIndex: params.slotIndex * params.columns + columnIndex,
			row: params.row,
		});
		if (cell) cells.push(cell);
	}
	return cells;
}
