import type { TwoHopSectionModel } from "two-hop/ui/twoHopSectionModel";
import { resolveCardLayoutSettings } from "cards/layout/cardLayoutCssVars";
import type { MutableStableScrollTopBand } from "cards/virtualization/public";
import type { VirtualRowLayoutMetrics } from "cards/virtualization/public";
import type { MutableRowRange, RowRange } from "cards/virtualization/public";
import type {
	VirtualNavigationDirection,
	VirtualNavigationTarget,
	VirtualSequentialNavigationDirection,
	VirtualSequentialNavigationTarget,
	VirtualRow,
	VirtualRowModel,
} from "cards/virtualization/public";
import {
	createSectionedGridGeometry,
	resolveVirtualRangesInto,
} from "cards/virtualization/public";

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

	const resolveRowTop = (rowIndex: number): number =>
		geometry.resolveRowTop(rowIndex) ?? 0;

	const getCell = (
		rowIndex: number,
		columnIndex: number,
	): TwoHopVirtualCell | null => {
		const row = geometry.resolveRow(rowIndex);
		if (!row || columnIndex < 0 || columnIndex >= row.cellCount) return null;
		const section = sections[row.sectionIndex]!;
		return resolveTwoHopCell(
			section,
			rowIndex,
			columnIndex,
			row.firstCellIndexInSection + columnIndex,
		);
	};

	const isSequentiallyFocusableCell = (cell: TwoHopVirtualCell): boolean =>
		cell.kind !== "header" ||
		Boolean(
			cell.section.header.props.interactionDescriptor ||
			cell.section.header.props.onClick,
		);

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
			let cellIndex = -1;
			if (logicalKey === section.header.logicalKey) {
				cellIndex = 0;
			} else if (logicalKey === `load-more:${section.id}`) {
				cellIndex = section.items.length + 1;
			} else {
				const itemPrefix = `item:${section.id}:`;
				if (!logicalKey.startsWith(itemPrefix)) continue;
				const itemKey = logicalKey.slice(itemPrefix.length);
				const itemIndex = section.items.findIndex(
					(item) => item.key === itemKey,
				);
				if (itemIndex >= 0) cellIndex = itemIndex + 1;
			}
			const position = geometry.resolveCellPosition(sectionIndex, cellIndex);
			if (position) return position;
		}
		return null;
	};

	const resolveNavigationTarget = (
		currentKey: string,
		direction: VirtualNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null => {
		const currentCell = getCell(
			currentPosition.rowIndex,
			currentPosition.columnIndex,
		);
		if (!currentCell || currentCell.logicalKey !== currentKey) return null;
		const target =
			direction === "left" || direction === "right"
				? resolveHorizontalNavigationTarget(
						getCell,
						columns,
						currentPosition,
						direction,
					)
				: resolveVerticalNavigationTarget(
						getCell,
						rowCount,
						columns,
						currentPosition,
						direction,
					);
		return target
			? { key: target.logicalKey, rowTop: resolveRowTop(target.rowIndex) }
			: null;
	};

	const resolveSequentialNavigationTarget = (
		currentKey: string,
		direction: VirtualSequentialNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualSequentialNavigationTarget | null => {
		const currentCell = getCell(
			currentPosition.rowIndex,
			currentPosition.columnIndex,
		);
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
					if (!targetCell || !isSequentiallyFocusableCell(targetCell))
						continue;
					return {
						key: targetCell.logicalKey,
						rowTop: row.top,
						rowIndex,
						columnIndex,
					};
				}
				rowIndex += 1;
				columnIndex = 0;
				continue;
			}

			for (; columnIndex >= 0; columnIndex -= 1) {
				const targetCell = row.getCell(columnIndex);
				if (!targetCell || !isSequentiallyFocusableCell(targetCell)) continue;
				return {
					key: targetCell.logicalKey,
					rowTop: row.top,
					rowIndex,
					columnIndex,
				};
			}
			rowIndex -= 1;
			const previousRow = getRow(rowIndex);
			columnIndex = previousRow ? previousRow.cellCount - 1 : -1;
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
		resolveNavigationTarget,
		resolveSequentialNavigationTarget,
		resolveCellPosition,
	};
	return rowModel;
}

function resolveSectionCellCount(section: TwoHopSectionModel): number {
	return (
		1 + section.items.length + (section.items.length < section.totalCount ? 1 : 0)
	);
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

function isFocusableCell(cell: TwoHopVirtualCell): boolean {
	return (
		cell.kind !== "header" ||
		cell.section.header.props.interactionDescriptor !== undefined ||
		cell.section.header.props.onClick !== undefined
	);
}

function resolveHorizontalNavigationTarget(
	getCell: (rowIndex: number, columnIndex: number) => TwoHopVirtualCell | null,
	columns: number,
	currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	direction: "left" | "right",
): TwoHopVirtualCell | null {
	const step = direction === "left" ? -1 : 1;
	for (
		let columnIndex = currentPosition.columnIndex + step;
		columnIndex >= 0 && columnIndex < columns;
		columnIndex += step
	) {
		const cell = getCell(currentPosition.rowIndex, columnIndex);
		if (cell && isFocusableCell(cell)) return cell;
	}
	return null;
}

function resolveVerticalNavigationTarget(
	getCell: (rowIndex: number, columnIndex: number) => TwoHopVirtualCell | null,
	rowCount: number,
	columns: number,
	currentPosition: { readonly rowIndex: number; readonly columnIndex: number },
	direction: "up" | "down",
): TwoHopVirtualCell | null {
	const step = direction === "up" ? -1 : 1;
	let fallback: TwoHopVirtualCell | null = null;
	for (
		let rowIndex = currentPosition.rowIndex + step;
		rowIndex >= 0 && rowIndex < rowCount;
		rowIndex += step
	) {
		for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
			const cell = getCell(rowIndex, columnIndex);
			if (!cell || !isFocusableCell(cell)) continue;
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

export interface TwoHopGridLayout {
	containerWidth: number;
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
	sectionMarginBottom: number;
}

export const DEFAULT_TWO_HOP_GRID_CARD_LAYOUT = resolveCardLayoutSettings();

export const DEFAULT_TWO_HOP_GRID_LAYOUT: TwoHopGridLayout = {
	containerWidth: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardWidthPx,
	columns: 1,
	cellWidth: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardWidthPx,
	rowHeight: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardHeightPx,
	gap: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.cardGapPx,
	sectionMarginBottom: DEFAULT_TWO_HOP_GRID_CARD_LAYOUT.sectionMarginBottomPx,
};

export const isSameTwoHopGridLayout = (
	current: TwoHopGridLayout,
	next: TwoHopGridLayout,
): boolean =>
	current.containerWidth === next.containerWidth &&
	current.columns === next.columns &&
	current.cellWidth === next.cellWidth &&
	current.rowHeight === next.rowHeight &&
	current.gap === next.gap &&
	current.sectionMarginBottom === next.sectionMarginBottom;
