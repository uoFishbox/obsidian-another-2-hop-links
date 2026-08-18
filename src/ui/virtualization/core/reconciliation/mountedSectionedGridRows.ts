import type { RowRange } from "ui/virtualization/rowRange";

export interface SectionedGridMountedCell {
	readonly columnIndex?: number;
	readonly renderSlotIndex: number;
}

export interface SectionedGridMountedRow<TCell extends SectionedGridMountedCell> {
	readonly rowIndex: number;
	readonly slotIndex: number;
	/** Physical column bindings. Empty physical slots are represented by null. */
	readonly bindings: readonly (TCell | null)[];
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
	readonly rowSlices: TRow[];
	readonly rowsBySlot: TRow[];
}

export interface BuildMountedSectionedGridRowsParams<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
	TRowMetadata,
> {
	readonly rowRange: RowRange;
	readonly columns: number;
	readonly slotCapacity: number;
	resolveSlotIndex(rowIndex: number): number | undefined;
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
	}): TCell | null;
	createRow(params: {
		readonly rowIndex: number;
		readonly slotIndex: number;
		readonly bindings: (TCell | null)[];
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TRow;
}

/**
 * Builds resident rows while preserving stable physical row/column slots.
 * Logical resolution stays with the caller; this function owns slot topology.
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

	for (
		let rowIndex = params.rowRange.start;
		rowIndex < params.rowRange.end;
		rowIndex += 1
	) {
		const slotIndex = params.resolveSlotIndex(rowIndex);
		if (slotIndex === undefined) {
			throw new Error(`No resident slot assigned for row ${rowIndex}.`);
		}

		const previousRow = params.resolvePreviousRow(rowIndex);
		if (
			previousRow !== undefined &&
			previousRow.slotIndex === slotIndex &&
			params.canReusePreviousRow(previousRow)
		) {
			rowSlices.push(previousRow);
			continue;
		}

		const row = params.resolveRow(rowIndex);
		if (!row) continue;
		const bindings =
			previousRow !== undefined &&
			params.rebindCell &&
			previousRow.bindings.length === columns
				? rebindPreviousBindings({
						previousRow,
						row,
						rowIndex,
						slotIndex,
						columns,
						rebindCell: params.rebindCell,
						resolveCell: params.resolveCell,
					})
				: resolveBindings({
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
				bindings,
				row,
			}),
		);
	}

	const rowsBySlot = orderRowsBySlotIndex(rowSlices);
	assertMountedSectionedGridRows({
		rows: rowsBySlot,
		slotCapacity: params.slotCapacity,
		columns,
	});

	return {
		get cells() {
			if (flattenedCells) return flattenedCells;
			flattenedCells = [];
			for (const row of rowSlices) {
				for (const binding of row.bindings) {
					if (binding) flattenedCells.push(binding);
				}
			}
			return flattenedCells;
		},
		rowSlices,
		rowsBySlot,
	};
}

/** Orders resident rows by physical slot in O(resident rows) without sorting. */
function orderRowsBySlotIndex<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
>(rows: readonly TRow[]): TRow[] {
	const rowsBySlot: (TRow | undefined)[] = [];
	for (const row of rows) rowsBySlot[row.slotIndex] = row;

	let writeIndex = 0;
	for (let readIndex = 0; readIndex < rowsBySlot.length; readIndex += 1) {
		const row = rowsBySlot[readIndex];
		if (row === undefined) continue;
		rowsBySlot[writeIndex] = row;
		writeIndex += 1;
	}
	rowsBySlot.length = writeIndex;
	return rowsBySlot as TRow[];
}

function assertMountedSectionedGridRows<
	TCell extends SectionedGridMountedCell,
	TRow extends SectionedGridMountedRow<TCell>,
>(params: {
	readonly rows: readonly TRow[];
	readonly slotCapacity: number;
	readonly columns: number;
}): void {
	if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
		return;
	}

	const logicalRows = new Set<number>();
	const rowSlots = new Set<number>();
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
		if (row.bindings.length !== params.columns) {
			throw new Error(
				`Mounted row ${row.rowIndex} has ${row.bindings.length} bindings; expected ${params.columns}.`,
			);
		}
		logicalRows.add(row.rowIndex);
		rowSlots.add(row.slotIndex);

		for (let columnIndex = 0; columnIndex < row.bindings.length; columnIndex += 1) {
			const binding = row.bindings[columnIndex];
			if (!binding) continue;
			const expectedSlotIndex = row.slotIndex * params.columns + columnIndex;
			if (binding.renderSlotIndex !== expectedSlotIndex) {
				throw new Error(
					`Mounted cell render slot ${binding.renderSlotIndex} does not match physical slot ${expectedSlotIndex}.`,
				);
			}
			if (
				binding.columnIndex !== undefined &&
				binding.columnIndex !== columnIndex
			) {
				throw new Error(
					`Mounted cell column ${binding.columnIndex} does not match physical column ${columnIndex}.`,
				);
			}
		}
	}
}

function rebindPreviousBindings<
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
	}): TCell | null;
	resolveCell(params: {
		readonly rowIndex: number;
		readonly columnIndex: number;
		readonly renderSlotIndex: number;
		readonly row: ResolvedSectionedGridRow<TRowMetadata>;
	}): TCell | null;
}): (TCell | null)[] {
	const bindings: (TCell | null)[] = [];
	for (let columnIndex = 0; columnIndex < params.columns; columnIndex += 1) {
		const renderSlotIndex = params.slotIndex * params.columns + columnIndex;
		const previousBinding = params.previousRow.bindings[columnIndex] ?? null;
		const isOccupied =
			columnIndex >= params.row.columnStart && columnIndex < params.row.columnEnd;
		bindings.push(
			!isOccupied
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
						}),
		);
	}
	return bindings;
}

function resolveBindings<TCell extends SectionedGridMountedCell, TRowMetadata>(params: {
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
}): (TCell | null)[] {
	const bindings: (TCell | null)[] = [];
	for (let columnIndex = 0; columnIndex < params.columns; columnIndex += 1) {
		const renderSlotIndex = params.slotIndex * params.columns + columnIndex;
		bindings.push(
			columnIndex >= params.row.columnStart && columnIndex < params.row.columnEnd
				? params.resolveCell({
						rowIndex: params.rowIndex,
						columnIndex,
						renderSlotIndex,
						row: params.row,
					})
				: null,
		);
	}
	return bindings;
}
