import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type {
	VirtualNavigationTarget,
	VirtualRanges,
	VirtualRow,
} from "ui/components/common/virtual-list/types";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { TwoHopVirtualListItem } from "../twoHopVirtualListModel";
import type {
	FirstTwoHopRowByTopResolutionScratch,
	ResolveTwoHopRowTopsForBandParams,
	StablePreviewScrollTopBandMutable,
	TwoHopBandRowTopsMutable,
	TwoHopViewPlan,
	TwoHopViewPlanRowModel,
} from "./types";
import { resolveTwoHopLogicalCellInSection } from "./twoHopMaterialization";
import {
	resolveTwoHopRowTopsForBandInto,
	writeTwoHopRowsByOffsetIntoScratch,
	writeTwoHopStablePreviewScrollTopBand,
} from "./twoHopRowRangeResolver";
import { resolveTwoHopNavigationTarget } from "./twoHopNavigation";
function copyRowRangeInto(out: RowRange, range: RowRange): void {
	out.start = range.start;
	out.end = range.end;
}

interface ResolveTwoHopVisibleRangesParams {
	scrollTop: number;
	viewportHeight: number;
	mountedOverscanPx: number;
	previewOverscanPx?: number;
	mounted?: RowRange;
	reuseMountedReference?: boolean;
}

function normalizePreviewOverscan(
	value: number | undefined,
	mountedOverscanPx: number,
): number {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
	return Math.min(mountedOverscanPx, value);
}

export function createTwoHopViewPlanRowModel(
	plan: TwoHopViewPlan,
): TwoHopViewPlanRowModel {
	const stablePreviewRowTops: TwoHopBandRowTopsMutable = {
		previousStartRowTop: null,
		currentStartRowTop: null,
		previousEndRowTop: null,
		currentEndRowTop: null,
	};
	// Reusable scratch for row-range resolution, held for the lifetime of
	// this row model to avoid per-scroll-frame allocation.
	const resolutionScratch: FirstTwoHopRowByTopResolutionScratch = {
		rowIndex: 0,
		sectionIndex: 0,
	};
	const writeVisibleRange = (
		out: RowRange,
		scrollTop: number,
		viewportHeight: number,
		overscanPx: number,
	): void => {
		writeTwoHopRowsByOffsetIntoScratch(
			out,
			resolutionScratch,
			plan.sections,
			plan.rowHeight,
			plan.rowGap,
			scrollTop,
			viewportHeight,
			overscanPx,
		);
	};
	const findRange = (params: {
		scrollTop: number;
		viewportHeight: number;
		overscanPx: number;
	}): RowRange => {
		const range = { start: 0, end: 0 };
		writeVisibleRange(
			range,
			params.scrollTop,
			params.viewportHeight,
			params.overscanPx,
		);
		return range;
	};
	const findRanges = (params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const ranges = {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		};
		return resolveMountedAndPreviewRangesInto(ranges, {
			...params,
			reuseMountedReference: true,
		});
	};
	const resolveMountedAndPreviewRangesInto = (
		out: VirtualRanges,
		params: ResolveTwoHopVisibleRangesParams,
	): VirtualRanges => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = normalizePreviewOverscan(
			params.previewOverscanPx,
			mountedOverscanPx,
		);
		if (params.mounted === undefined) {
			writeVisibleRange(
				out.mounted,
				params.scrollTop,
				params.viewportHeight,
				mountedOverscanPx,
			);
		} else if (params.reuseMountedReference === true) {
			out.mounted = params.mounted;
		} else {
			copyRowRangeInto(out.mounted, params.mounted);
		}
		if (previewOverscanPx >= mountedOverscanPx) {
			if (params.reuseMountedReference === true) {
				out.previewVisible = out.mounted;
				return out;
			}
			copyRowRangeInto(out.previewVisible, out.mounted);
			return out;
		}
		writeVisibleRange(
			out.previewVisible,
			params.scrollTop,
			params.viewportHeight,
			previewOverscanPx,
		);
		return out;
	};
	const findRangesInto = (
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		resolveMountedAndPreviewRangesInto(out, params);
	};
	const findRangesFromMounted = (params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const ranges = {
			mounted: { start: 0, end: 0 },
			previewVisible: { start: 0, end: 0 },
		};
		return resolveMountedAndPreviewRangesInto(ranges, {
			...params,
			reuseMountedReference: true,
		});
	};
	const findRangesFromMountedInto = (
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void => {
		resolveMountedAndPreviewRangesInto(out, params);
	};
	const findStablePreviewScrollTopBandInto = (
		out: StablePreviewScrollTopBandMutable,
		params: {
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		const previewOverscanPx = Math.min(
			mountedOverscanPx,
			Math.max(0, params.previewOverscanPx ?? 0),
		);
		if (previewOverscanPx >= mountedOverscanPx) {
			out.min = Number.NEGATIVE_INFINITY;
			out.max = Number.POSITIVE_INFINITY;
			return;
		}
		writeTwoHopStablePreviewScrollTopBand(out, stablePreviewRowTops, plan, {
			previewVisible: params.previewVisible,
			viewportHeight: params.viewportHeight,
			overscanPx: previewOverscanPx,
		});
	};
	const findStableMountedScrollTopBandInto = (
		out: StablePreviewScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void => {
		const mountedOverscanPx = Math.max(0, params.mountedOverscanPx);
		writeTwoHopStablePreviewScrollTopBand(out, stablePreviewRowTops, plan, {
			previewVisible: params.mounted,
			viewportHeight: params.viewportHeight,
			overscanPx: mountedOverscanPx,
		});
	};
	const resolveRowTopsForBandInto = (
		out: TwoHopBandRowTopsMutable,
		params: ResolveTwoHopRowTopsForBandParams,
	): void => {
		resolveTwoHopRowTopsForBandInto(out, plan, params);
	};
	const table = plan.rowTable;
	const getRowCellCountAt = (rowIndex: number): number =>
		rowIndex < 0 || rowIndex >= table.rowCount ? 0 : table.cellCountByRow[rowIndex];
	const getRowTopAt = (rowIndex: number): number =>
		rowIndex < 0 || rowIndex >= table.rowCount ? 0 : table.topByRow[rowIndex];
	const resolveCell = (
		rowIndex: number,
		columnIndex: number,
	): VirtualListLogicalCell<TwoHopVirtualListItem> | null => {
		if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
		const cellCount = table.cellCountByRow[rowIndex];
		if (columnIndex < 0 || columnIndex >= cellCount) return null;
		return resolveTwoHopLogicalCellInSection(
			plan,
			table.sectionIndexByRow[rowIndex],
			table.sectionCellStartByRow[rowIndex] + columnIndex,
		);
	};
	const resolveNavigationTarget = (
		_currentKey: string,
		direction: ResultNavigationDirection,
		currentPosition: { rowIndex: number; columnIndex: number },
	): VirtualNavigationTarget | null => {
		return resolveTwoHopNavigationTarget({
			direction,
			currentPosition,
			getRowCellCount: getRowCellCountAt,
			getRowTop: getRowTopAt,
			resolveCell,
		});
	};

	return {
		plan,
		revision: { kind: "opaque", token: plan },
		rowCount: plan.rowCount,
		totalHeight: plan.totalHeight,
		layout: { ...plan.layout, contentHeight: plan.totalHeight },
		getRow(
			rowIndex,
		): VirtualRow<VirtualListLogicalCell<TwoHopVirtualListItem>> | null {
			if (rowIndex < 0 || rowIndex >= table.rowCount) return null;
			return {
				key: rowIndex,
				index: rowIndex,
				top: table.topByRow[rowIndex],
				height: plan.rowHeight,
				bottomSpacing: plan.rowGap,
				cellCount: table.cellCountByRow[rowIndex],
				getCell(columnIndex) {
					return resolveCell(rowIndex, columnIndex);
				},
			};
		},
		getRowCellCount: getRowCellCountAt,
		getRowTop: getRowTopAt,
		getRowEnd: (rowIndex) => {
			if (rowIndex < 0 || rowIndex >= table.rowCount) return 0;
			return table.topByRow[rowIndex] + plan.rowHeight;
		},
		findVisibleRange: findRange,
		findVisibleRangeInto: (out, params) => {
			writeVisibleRange(
				out,
				params.scrollTop,
				params.viewportHeight,
				params.overscanPx,
			);
		},
		findVisibleRanges: findRanges,
		findVisibleRangesInto: findRangesInto,
		findVisibleRangesFromMounted: findRangesFromMounted,
		findVisibleRangesFromMountedInto: findRangesFromMountedInto,
		findStablePreviewScrollTopBandInto,
		findStableMountedScrollTopBandInto,
		resolveRowTopsForBandInto,
		resolveNavigationTarget,
	};
}
