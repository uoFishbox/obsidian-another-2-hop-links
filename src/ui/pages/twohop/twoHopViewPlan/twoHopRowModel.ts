import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import {
	createMutableVirtualRanges,
	normalizePreviewOverscan,
	resolveVirtualRangesInto,
	resolveVisibleRange,
} from "ui/components/common/virtual-list/virtualRanges";
import type {
	FindVisibleRangeParams,
	ResolveVirtualRangesParams,
} from "ui/components/common/virtual-list/virtualRanges";
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
import {
	resolveTwoHopRowTopsForBandInto,
	writeTwoHopRowsByOffsetIntoScratch,
	writeTwoHopStablePreviewScrollTopBand,
} from "./twoHopRowRangeResolver";
import { resolveTwoHopNavigationTarget } from "./twoHopNavigation";
import { readTwoHopRowPlan } from "./twoHopRowTable";

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
			plan.sectionTable,
			plan.rowHeight,
			plan.rowGap,
			scrollTop,
			viewportHeight,
			overscanPx,
		);
	};
	const findRange = (params: FindVisibleRangeParams): RowRange => {
		return resolveVisibleRange(writeVisibleRange, params);
	};
	const findRanges = (params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges => {
		const ranges = createMutableVirtualRanges();
		return resolveMountedAndPreviewRangesInto(ranges, {
			...params,
			reuseMountedReference: true,
		});
	};
	const resolveMountedAndPreviewRangesInto = (
		out: VirtualRanges,
		params: ResolveVirtualRangesParams,
	): VirtualRanges => {
		return resolveVirtualRangesInto(out, params, writeVisibleRange);
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
		const ranges = createMutableVirtualRanges();
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
		const previewOverscanPx = normalizePreviewOverscan(
			params.previewOverscanPx,
			mountedOverscanPx,
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
	const getRowCellCountAt = (rowIndex: number): number =>
		readTwoHopRowPlan(plan, rowIndex)?.cellCount ?? 0;
	const getRowTopAt = (rowIndex: number): number =>
		readTwoHopRowPlan(plan, rowIndex)?.top ?? 0;
	const resolveCell = (
		rowIndex: number,
		columnIndex: number,
	): VirtualListLogicalCell<TwoHopVirtualListItem> | null => {
		const row = readTwoHopRowPlan(plan, rowIndex);
		if (!row) return null;
		const cellCount = row.cellCount;
		if (columnIndex < 0 || columnIndex >= cellCount) return null;
		return (
			plan.sections[row.sectionIndex]?.itemSource.readCell(
				row.sectionCellStartIndex + columnIndex,
			) ?? null
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
			const row = readTwoHopRowPlan(plan, rowIndex);
			if (!row) return null;
			return {
				key: rowIndex,
				index: rowIndex,
				top: row.top,
				height: plan.rowHeight,
				bottomSpacing: plan.rowGap,
				cellCount: row.cellCount,
				getCell(columnIndex) {
					return resolveCell(rowIndex, columnIndex);
				},
			};
		},
		getRowCellCount: getRowCellCountAt,
		getRowTop: getRowTopAt,
		getRowEnd: (rowIndex) => {
			const row = readTwoHopRowPlan(plan, rowIndex);
			return row ? row.top + plan.rowHeight : 0;
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
