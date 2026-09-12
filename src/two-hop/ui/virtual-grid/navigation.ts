import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";
import type { TwoHopSectionModel } from "two-hop/ui/twoHopSectionModel";

export interface TwoHopCellPosition {
	readonly rowIndex: number;
	readonly columnIndex: number;
}

/**
 * Minimal cell surface required by keyboard navigation. `TwoHopVirtualCell`
 * satisfies it, so this module never has to import the row-model builder.
 */
export interface TwoHopNavigationCell extends TwoHopCellPosition {
	readonly logicalKey: string;
	readonly kind: "header" | "item" | "load-more";
	readonly section: TwoHopSectionModel;
}

export interface TwoHopNavigationRow<TCell extends TwoHopNavigationCell> {
	readonly top: number;
	readonly cellCount: number;
	getCell(columnIndex: number): TCell | null;
}

export interface TwoHopNavigationGrid<TCell extends TwoHopNavigationCell> {
	readonly rowCount: number;
	getRow(rowIndex: number): TwoHopNavigationRow<TCell> | null;
}

export interface TwoHopNavigationTarget<TCell> {
	readonly cell: TCell;
	readonly rowTop: number;
}

export interface TwoHopSequentialNavigationTarget<TCell>
	extends TwoHopNavigationTarget<TCell>, TwoHopCellPosition {}

/**
 * Section headers without an interaction are skipped by sequential focus.
 * This is the only place the focusability policy is defined.
 */
function isFocusableTwoHopCell(cell: TwoHopNavigationCell): boolean {
	return (
		cell.kind !== "header" ||
		cell.section.header.props.interactionDescriptor !== undefined ||
		cell.section.header.props.onClick !== undefined
	);
}

/** Resolves one arrow-key target inside the virtual grid. */
export function resolveTwoHopNavigationTarget<TCell extends TwoHopNavigationCell>(
	grid: TwoHopNavigationGrid<TCell>,
	currentKey: string,
	direction: NavigationDirection,
	currentPosition: TwoHopCellPosition,
): TwoHopNavigationTarget<TCell> | null {
	const currentCell = resolveCellAt(grid, currentPosition);
	if (!currentCell || currentCell.logicalKey !== currentKey) return null;

	const target =
		direction === "left" || direction === "right"
			? resolveHorizontalTarget(grid, currentPosition, direction)
			: resolveVerticalTarget(grid, currentPosition, direction);
	if (!target) return null;
	return { cell: target, rowTop: resolveRowTop(grid, target.rowIndex) };
}

/** Resolves one sequential (tab order) target inside the virtual grid. */
export function resolveTwoHopSequentialNavigationTarget<
	TCell extends TwoHopNavigationCell,
>(
	grid: TwoHopNavigationGrid<TCell>,
	currentKey: string,
	direction: SequentialNavigationDirection,
	currentPosition: TwoHopCellPosition,
): TwoHopSequentialNavigationTarget<TCell> | null {
	const currentCell = resolveCellAt(grid, currentPosition);
	if (!currentCell || currentCell.logicalKey !== currentKey) return null;

	const step = direction === "forward" ? 1 : -1;
	let rowIndex = currentPosition.rowIndex;
	let columnIndex = currentPosition.columnIndex + step;

	while (rowIndex >= 0 && rowIndex < grid.rowCount) {
		const row = grid.getRow(rowIndex);
		if (!row) return null;

		if (direction === "forward") {
			for (; columnIndex < row.cellCount; columnIndex += 1) {
				const targetCell = row.getCell(columnIndex);
				if (!targetCell || !isFocusableTwoHopCell(targetCell)) continue;
				return { cell: targetCell, rowTop: row.top, rowIndex, columnIndex };
			}
			rowIndex += 1;
			columnIndex = 0;
			continue;
		}

		for (; columnIndex >= 0; columnIndex -= 1) {
			const targetCell = row.getCell(columnIndex);
			if (!targetCell || !isFocusableTwoHopCell(targetCell)) continue;
			return { cell: targetCell, rowTop: row.top, rowIndex, columnIndex };
		}
		rowIndex -= 1;
		const previousRow = grid.getRow(rowIndex);
		columnIndex = previousRow ? previousRow.cellCount - 1 : -1;
	}

	return null;
}

/** True when the current item is the first item row in the grid. */
export function shouldMoveFocusAboveTwoHopGrid<TCell extends TwoHopNavigationCell>(
	grid: TwoHopNavigationGrid<TCell>,
	currentKey: string,
	currentPosition: TwoHopCellPosition,
): boolean {
	const currentCell = resolveCellAt(grid, currentPosition);
	if (
		!currentCell ||
		currentCell.logicalKey !== currentKey ||
		currentCell.kind !== "item"
	) {
		return false;
	}

	for (let rowIndex = 0; rowIndex < currentPosition.rowIndex; rowIndex += 1) {
		const row = grid.getRow(rowIndex);
		if (!row) continue;
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			if (row.getCell(columnIndex)?.kind === "item") return false;
		}
	}
	return true;
}

function resolveCellAt<TCell extends TwoHopNavigationCell>(
	grid: TwoHopNavigationGrid<TCell>,
	position: TwoHopCellPosition,
): TCell | null {
	return grid.getRow(position.rowIndex)?.getCell(position.columnIndex) ?? null;
}

function resolveRowTop<TCell extends TwoHopNavigationCell>(
	grid: TwoHopNavigationGrid<TCell>,
	rowIndex: number,
): number {
	return grid.getRow(rowIndex)?.top ?? 0;
}

function resolveHorizontalTarget<TCell extends TwoHopNavigationCell>(
	grid: TwoHopNavigationGrid<TCell>,
	currentPosition: TwoHopCellPosition,
	direction: "left" | "right",
): TCell | null {
	if (direction === "left") {
		for (
			let columnIndex = currentPosition.columnIndex - 1;
			columnIndex >= 0;
			columnIndex -= 1
		) {
			const cell = grid.getRow(currentPosition.rowIndex)?.getCell(columnIndex);
			if (cell && isFocusableTwoHopCell(cell)) return cell;
		}

		for (
			let rowIndex = currentPosition.rowIndex - 1;
			rowIndex >= 0;
			rowIndex -= 1
		) {
			const row = grid.getRow(rowIndex);
			if (!row) continue;
			for (
				let columnIndex = row.cellCount - 1;
				columnIndex >= 0;
				columnIndex -= 1
			) {
				const cell = row.getCell(columnIndex);
				if (cell && isFocusableTwoHopCell(cell)) return cell;
			}
		}

		return null;
	}

	const currentRow = grid.getRow(currentPosition.rowIndex);
	if (currentRow) {
		for (
			let columnIndex = currentPosition.columnIndex + 1;
			columnIndex < currentRow.cellCount;
			columnIndex += 1
		) {
			const cell = currentRow.getCell(columnIndex);
			if (cell && isFocusableTwoHopCell(cell)) return cell;
		}
	}

	for (
		let rowIndex = currentPosition.rowIndex + 1;
		rowIndex < grid.rowCount;
		rowIndex += 1
	) {
		const row = grid.getRow(rowIndex);
		if (!row) continue;
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			const cell = row.getCell(columnIndex);
			if (cell && isFocusableTwoHopCell(cell)) return cell;
		}
	}

	return null;
}

function resolveVerticalTarget<TCell extends TwoHopNavigationCell>(
	grid: TwoHopNavigationGrid<TCell>,
	currentPosition: TwoHopCellPosition,
	direction: "up" | "down",
): TCell | null {
	const step = direction === "up" ? -1 : 1;
	let fallback: TCell | null = null;
	for (
		let rowIndex = currentPosition.rowIndex + step;
		rowIndex >= 0 && rowIndex < grid.rowCount;
		rowIndex += step
	) {
		const row = grid.getRow(rowIndex);
		if (!row) continue;
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			const cell = row.getCell(columnIndex);
			if (!cell || !isFocusableTwoHopCell(cell)) continue;
			if (columnIndex === currentPosition.columnIndex) return cell;
			fallback ??= cell;
		}
	}
	return fallback;
}
