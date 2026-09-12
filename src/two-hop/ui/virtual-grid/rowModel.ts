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
import {
	resolveTwoHopNavigationTarget,
	resolveTwoHopSequentialNavigationTarget,
	type TwoHopNavigationGrid,
} from "./navigation";

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

	const navigationGrid: TwoHopNavigationGrid<TwoHopVirtualCell> = {
		rowCount,
		getRow,
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
				navigationGrid,
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
				navigationGrid,
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

function writeInvalidBand(out: MutableStableScrollTopBand): void {
	out.min = Number.POSITIVE_INFINITY;
	out.max = Number.NEGATIVE_INFINITY;
}
