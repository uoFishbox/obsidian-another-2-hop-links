import type { MutableStableScrollTopBand } from "cards/virtualization/public";
import type { MutableRowRange, RowRange } from "cards/virtualization/public";
import type {
	VirtualRow,
	VirtualRowLayoutMetrics,
	VirtualRowModel,
} from "cards/virtualization/public";
import {
	createSectionedGridGeometry,
	resolveVirtualRangesInto,
} from "cards/virtualization/public";
import type { TwoHopSectionModel } from "two-hop/ui/twoHopSectionModel";
import type { TwoHopGridLayout } from "./layout";
import type {
	NavigationDirection,
	SequentialNavigationDirection,
} from "cards/navigation/types";

interface TwoHopCellBase {
	readonly logicalKey: string;
	readonly section: TwoHopSectionModel;
	readonly rowIndex: number;
	readonly columnIndex: number;
}

export type TwoHopVirtualCell =
	| (TwoHopCellBase & { readonly kind: "header" })
	| (TwoHopCellBase & {
			readonly kind: "item";
			readonly itemIndex: number;
			readonly item: TwoHopSectionModel["items"][number];
	  })
	| (TwoHopCellBase & { readonly kind: "load-more" });

export interface TwoHopRowLayoutMetrics extends VirtualRowLayoutMetrics {
	readonly rowStride: number;
	readonly sectionMarginBottom: number;
}

export interface TwoHopRowModel extends VirtualRowModel<TwoHopVirtualCell> {
	readonly layout: TwoHopRowLayoutMetrics;
	findMountedCoverageScrollTopBandInto(
		out: MutableStableScrollTopBand,
		params: {
			viewportHeight: number;
			mounted: RowRange;
			requiredOverscanPx: number;
		},
	): void;
	resolveCellPosition(logicalKey: string): {
		readonly rowIndex: number;
		readonly columnIndex: number;
	} | null;
	shouldMoveFocusAboveGrid(
		currentKey: string,
		currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	): boolean;
}

export interface CreateTwoHopRowModelParams {
	readonly sections: readonly TwoHopSectionModel[];
	readonly layout: TwoHopGridLayout;
}

/** Compiles section prefixes into the row-model boundary consumed by the shared engine. */
export function createTwoHopRowModel(
	params: CreateTwoHopRowModelParams,
): TwoHopRowModel {
	const { sections } = params;
	const geometry = createSectionedGridGeometry({
		sectionCellCounts: sections.map(resolveSectionCellCount),
		columns: params.layout.columns,
		rowHeight: Math.max(1, params.layout.rowHeight),
		gap: params.layout.gap,
		sectionMarginBottom: params.layout.sectionMarginBottom,
	});
	const {
		columns,
		rowHeight,
		gap,
		rowStride,
		sectionMarginBottom,
		rowCount,
		totalHeight,
	} = geometry;

	const layout: TwoHopRowLayoutMetrics = {
		containerWidth: params.layout.containerWidth,
		columns,
		cellWidth: params.layout.cellWidth,
		gap,
		rowHeight,
		contentHeight: totalHeight,
		rowStride,
		sectionMarginBottom,
	};

	const getRow = (rowIndex: number): VirtualRow<TwoHopVirtualCell> | null => {
		const row = geometry.resolveRow(rowIndex);
		if (!row) return null;
		const section = sections[row.sectionIndex]!;
		return {
			top: row.top,
			cellCount: row.cellCount,
			getCell(columnIndex) {
				if (columnIndex < 0 || columnIndex >= row.cellCount) return null;
				return resolveTwoHopCell(
					section,
					rowIndex,
					columnIndex,
					row.firstCellIndexInSection + columnIndex,
				);
			},
		};
	};

	const resolveRowTop = (rowIndex: number): number =>
		geometry.resolveRowTop(rowIndex) ?? 0;

	const writeVisibleRange = (
		out: MutableRowRange,
		scrollTop: number,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		const overscan = Math.max(0, overscanPx);
		writeVisibleRangeWithoutOverscan(
			out,
			scrollTop - overscan,
			viewportHeight + overscan * 2,
		);
	};

	const writeVisibleRangeWithoutOverscan = (
		out: MutableRowRange,
		scrollTop: number,
		viewportHeight: number,
	): void => {
		const viewportTop = Math.max(0, scrollTop);
		const viewportBottom = Math.min(totalHeight, scrollTop + viewportHeight);
		if (rowCount === 0 || viewportHeight <= 0 || viewportBottom <= viewportTop) {
			out.start = 0;
			out.end = 0;
			return;
		}
		out.start = geometry.resolveFirstRowEndingAfter(scrollTop);
		out.end = geometry.resolveFirstRowStartingAtOrAfter(viewportBottom);
	};

	const resolveCellPosition = (
		logicalKey: string,
	): { readonly rowIndex: number; readonly columnIndex: number } | null => {
		for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
			const section = sections[sectionIndex]!;
			const cellIndex = resolveSectionCellIndexForKey(section, logicalKey);
			if (cellIndex < 0) continue;
			const position = geometry.resolveCellPosition(sectionIndex, cellIndex);
			if (position) return position;
		}
		return null;
	};

	const rowModel: TwoHopRowModel = {
		rowCount,
		totalHeight,
		layout,
		getRow,
		findVisibleRangeInto(out, rangeParams) {
			writeVisibleRange(
				out,
				rangeParams.scrollTop,
				rangeParams.viewportHeight,
				rangeParams.overscanPx,
			);
		},
		findVisibleRangesInto(out, rangeParams) {
			resolveVirtualRangesInto(out, rangeParams, writeVisibleRange);
		},
		findMountedCoverageScrollTopBandInto(out, bandParams) {
			const { mounted, viewportHeight } = bandParams;
			if (mounted.start >= mounted.end || viewportHeight <= 0) {
				writeInvalidBand(out);
				return;
			}
			const requiredOverscanPx = Math.max(0, bandParams.requiredOverscanPx);
			out.min =
				mounted.start === 0
					? -viewportHeight
					: resolveRowTop(mounted.start - 1) + rowHeight + requiredOverscanPx;
			out.max =
				mounted.end >= rowCount
					? totalHeight
					: resolveRowTop(mounted.end) - viewportHeight - requiredOverscanPx;
			if (out.min >= out.max) writeInvalidBand(out);
		},
		resolveNavigationTarget(currentKey, direction, currentPosition) {
			const target = resolveTwoHopNavigationTarget(
				getRow,
				rowCount,
				currentKey,
				direction,
				currentPosition,
			);
			return target
				? { key: target.cell.logicalKey, rowTop: target.rowTop }
				: null;
		},
		resolveSequentialNavigationTarget(currentKey, direction, currentPosition) {
			const target = resolveTwoHopSequentialNavigationTarget(
				getRow,
				rowCount,
				currentKey,
				direction,
				currentPosition,
			);
			return target
				? {
						key: target.cell.logicalKey,
						rowTop: target.rowTop,
						rowIndex: target.rowIndex,
						columnIndex: target.columnIndex,
					}
				: null;
		},
		resolveCellPosition,
		shouldMoveFocusAboveGrid(currentKey, currentPosition) {
			return shouldMoveFocusAboveTwoHopGrid(
				getRow,
				rowCount,
				currentKey,
				currentPosition,
			);
		},
	};
	return rowModel;
}

function resolveSectionCellCount(section: TwoHopSectionModel): number {
	return (
		1 + section.items.length + (section.items.length < section.totalCount ? 1 : 0)
	);
}

function resolveSectionCellIndexForKey(
	section: TwoHopSectionModel,
	logicalKey: string,
): number {
	if (logicalKey === section.header.logicalKey) return 0;
	if (logicalKey === `load-more:${section.id}`) return section.items.length + 1;

	const itemPrefix = `item:${section.id}:`;
	if (!logicalKey.startsWith(itemPrefix)) return -1;
	const itemKey = logicalKey.slice(itemPrefix.length);
	const itemIndex = section.items.findIndex((item) => item.key === itemKey);
	return itemIndex >= 0 ? itemIndex + 1 : -1;
}

function resolveTwoHopCell(
	section: TwoHopSectionModel,
	rowIndex: number,
	columnIndex: number,
	cellIndex: number,
): TwoHopVirtualCell | null {
	if (cellIndex === 0) {
		return {
			section,
			rowIndex,
			columnIndex,
			kind: "header",
			logicalKey: section.header.logicalKey,
		};
	}
	const itemIndex = cellIndex - 1;
	const item = section.items[itemIndex];
	if (item) {
		return {
			section,
			rowIndex,
			columnIndex,
			kind: "item",
			logicalKey: `item:${section.id}:${item.key}`,
			itemIndex,
			item,
		};
	}
	if (
		itemIndex === section.items.length &&
		section.items.length < section.totalCount
	) {
		return {
			section,
			rowIndex,
			columnIndex,
			kind: "load-more",
			logicalKey: `load-more:${section.id}`,
		};
	}
	return null;
}
type GetTwoHopNavigationRow = (
	rowIndex: number,
) => VirtualRow<TwoHopVirtualCell> | null;

interface TwoHopCellPosition {
	readonly rowIndex: number;
	readonly columnIndex: number;
}

interface TwoHopNavigationTarget {
	readonly cell: TwoHopVirtualCell;
	readonly rowTop: number;
}

interface TwoHopSequentialNavigationTarget
	extends TwoHopNavigationTarget, TwoHopCellPosition {}

/**
 * Section headers without an interaction are skipped by sequential focus.
 * This is the only place the focusability policy is defined.
 */
function isFocusableTwoHopCell(cell: TwoHopVirtualCell): boolean {
	return (
		cell.kind !== "header" ||
		cell.section.header.props.interactionDescriptor !== undefined ||
		cell.section.header.props.onClick !== undefined
	);
}

function resolveTwoHopCellAt(
	getRow: GetTwoHopNavigationRow,
	position: TwoHopCellPosition,
): TwoHopVirtualCell | null {
	return getRow(position.rowIndex)?.getCell(position.columnIndex) ?? null;
}

function resolveTwoHopRowTop(getRow: GetTwoHopNavigationRow, rowIndex: number): number {
	return getRow(rowIndex)?.top ?? 0;
}

/** Resolves one arrow-key target inside the virtual grid. */
function resolveTwoHopNavigationTarget(
	getRow: GetTwoHopNavigationRow,
	rowCount: number,
	currentKey: string,
	direction: NavigationDirection,
	currentPosition: TwoHopCellPosition,
): TwoHopNavigationTarget | null {
	const currentCell = resolveTwoHopCellAt(getRow, currentPosition);
	if (!currentCell || currentCell.logicalKey !== currentKey) return null;

	const target =
		direction === "left" || direction === "right"
			? resolveTwoHopHorizontalTarget(
					getRow,
					rowCount,
					currentPosition,
					direction,
				)
			: resolveTwoHopVerticalTarget(getRow, rowCount, currentPosition, direction);
	if (!target) return null;
	return { cell: target, rowTop: resolveTwoHopRowTop(getRow, target.rowIndex) };
}

/** Resolves one sequential (tab order) target inside the virtual grid. */
function resolveTwoHopSequentialNavigationTarget(
	getRow: GetTwoHopNavigationRow,
	rowCount: number,
	currentKey: string,
	direction: SequentialNavigationDirection,
	currentPosition: TwoHopCellPosition,
): TwoHopSequentialNavigationTarget | null {
	const currentCell = resolveTwoHopCellAt(getRow, currentPosition);
	if (!currentCell || currentCell.logicalKey !== currentKey) return null;

	const step = direction === "forward" ? 1 : -1;
	let rowIndex = currentPosition.rowIndex;
	let columnIndex = currentPosition.columnIndex + step;

	while (rowIndex >= 0 && rowIndex < rowCount) {
		const row = getRow(rowIndex);
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
		const previousRow = getRow(rowIndex);
		columnIndex = previousRow ? previousRow.cellCount - 1 : -1;
	}

	return null;
}

/** True when the current item is the first item row in the grid. */
function shouldMoveFocusAboveTwoHopGrid(
	getRow: GetTwoHopNavigationRow,
	rowCount: number,
	currentKey: string,
	currentPosition: TwoHopCellPosition,
): boolean {
	const currentCell = resolveTwoHopCellAt(getRow, currentPosition);
	if (
		!currentCell ||
		currentCell.logicalKey !== currentKey ||
		currentCell.kind !== "item"
	) {
		return false;
	}

	for (let rowIndex = 0; rowIndex < currentPosition.rowIndex; rowIndex += 1) {
		const row = getRow(rowIndex);
		if (!row) continue;
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			if (row.getCell(columnIndex)?.kind === "item") return false;
		}
	}
	return true;
}

function resolveTwoHopHorizontalTarget(
	getRow: GetTwoHopNavigationRow,
	rowCount: number,
	currentPosition: TwoHopCellPosition,
	direction: "left" | "right",
): TwoHopVirtualCell | null {
	if (direction === "left") {
		for (
			let columnIndex = currentPosition.columnIndex - 1;
			columnIndex >= 0;
			columnIndex -= 1
		) {
			const cell = getRow(currentPosition.rowIndex)?.getCell(columnIndex);
			if (cell && isFocusableTwoHopCell(cell)) return cell;
		}

		for (
			let rowIndex = currentPosition.rowIndex - 1;
			rowIndex >= 0;
			rowIndex -= 1
		) {
			const row = getRow(rowIndex);
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

	const currentRow = getRow(currentPosition.rowIndex);
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
		rowIndex < rowCount;
		rowIndex += 1
	) {
		const row = getRow(rowIndex);
		if (!row) continue;
		for (let columnIndex = 0; columnIndex < row.cellCount; columnIndex += 1) {
			const cell = row.getCell(columnIndex);
			if (cell && isFocusableTwoHopCell(cell)) return cell;
		}
	}

	return null;
}

function resolveTwoHopVerticalTarget(
	getRow: GetTwoHopNavigationRow,
	rowCount: number,
	currentPosition: TwoHopCellPosition,
	direction: "up" | "down",
): TwoHopVirtualCell | null {
	const step = direction === "up" ? -1 : 1;
	let fallback: TwoHopVirtualCell | null = null;
	for (
		let rowIndex = currentPosition.rowIndex + step;
		rowIndex >= 0 && rowIndex < rowCount;
		rowIndex += step
	) {
		const row = getRow(rowIndex);
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

function writeInvalidBand(out: MutableStableScrollTopBand): void {
	out.min = Number.POSITIVE_INFINITY;
	out.max = Number.NEGATIVE_INFINITY;
}
