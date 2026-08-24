import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import type { StableScrollTopBand } from "ui/virtualization/public";
import type { VirtualRowLayoutMetrics } from "ui/virtualization/public";
import type { MutableRowRange, RowRange } from "ui/virtualization/public";
import type { ViewPlanLayoutMetrics } from "./layout";
import type {
	VirtualNavigationDirection,
	VirtualNavigationTarget,
	VirtualRow,
	VirtualRowModel,
} from "ui/virtualization/public";
import {
	createSectionedGridGeometry,
	resolveVirtualRangesInto,
} from "ui/virtualization/public";

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

type MutableStableScrollTopBand = {
	-readonly [K in keyof StableScrollTopBand]: StableScrollTopBand[K];
};

export interface TwoHopRowModel extends VirtualRowModel<TwoHopVirtualCell> {
	readonly layout: TwoHopRowLayoutMetrics;
	findStableMountedScrollTopBandInto(
		out: MutableStableScrollTopBand,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void;
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
	readonly layout: ViewPlanLayoutMetrics;
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

	const writeStableBand = (
		out: MutableStableScrollTopBand,
		range: RowRange,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		if (range.start >= range.end || viewportHeight <= 0) {
			writeInvalidBand(out);
			return;
		}
		const overscan = Math.max(0, overscanPx);
		const expandedViewportHeight = viewportHeight + overscan * 2;
		const startMin =
			range.start === 0
				? Number.NEGATIVE_INFINITY
				: resolveRowTop(range.start - 1) + rowHeight;
		const startMax =
			range.start >= rowCount
				? Number.POSITIVE_INFINITY
				: resolveRowTop(range.start) + rowHeight;
		const endMin =
			range.end === 0
				? Number.NEGATIVE_INFINITY
				: resolveRowTop(range.end - 1) - expandedViewportHeight;
		const endMax =
			range.end >= rowCount
				? Number.POSITIVE_INFINITY
				: resolveRowTop(range.end) - expandedViewportHeight;
		out.min = Math.max(startMin, endMin, -expandedViewportHeight) + overscan;
		out.max = Math.min(startMax, endMax, totalHeight) + overscan;
		if (out.min >= out.max) writeInvalidBand(out);
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

	const rowModel: TwoHopRowModel = {
		revision: {
			content: sections,
			layout: Object.freeze([
				layout.containerWidth,
				layout.columns,
				layout.cellWidth,
				layout.rowHeight,
				layout.gap,
				layout.sectionMarginBottom,
			]),
		},
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
		findStableMountedScrollTopBandInto(out, bandParams) {
			writeStableBand(
				out,
				bandParams.mounted,
				bandParams.viewportHeight,
				bandParams.mountedOverscanPx,
			);
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
		cell.kind !== "header" || cell.section.header.props.interactionId !== undefined
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
