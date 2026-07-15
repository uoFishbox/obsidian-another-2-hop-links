import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { StablePreviewScrollTopBand } from "ui/components/common/virtual-list/core/scrollWindowGate";
import type {
	VirtualNavigationTarget,
	VirtualRanges,
	VirtualRowModel,
} from "ui/components/common/virtual-list/types";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type {
	RenderBodyKey,
	RenderRevision,
} from "ui/components/common/virtual-list/renderRevision";
import type { SectionLayout } from "ui/components/common/virtual-list/layout/viewPlanRowTypes";
import type {
	TwoHopVirtualListSection,
	TwoHopVirtualListItem,
} from "../twoHopVirtualListModel";
import type { TwoHopCellStaticState } from "../twoHopCellStaticState";
export interface TwoHopSectionPlan {
	readonly descriptor: SectionRenderDescriptor<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>;
	readonly sectionIndex: number;
	readonly sectionId: string;
	readonly sectionIdPrefix: string;
	readonly top: number;
	readonly height: number;
	readonly firstRowIndex: number;
	readonly rowCount: number;
	readonly firstCellIndex: number;
	readonly cellCount: number;
	readonly visibleCount: number;
	readonly showLoadMore: boolean;
	readonly mountedLayout: SectionLayout<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>;
}

/** Immutable cell identity compiled before the scroll hot path begins. */
export interface CompiledTwoHopCell extends TwoHopCellStaticState {
	readonly logicalCell: VirtualListLogicalCell<TwoHopVirtualListItem>;
	readonly logicalKey: VirtualListLogicalCell<TwoHopVirtualListItem>["key"];
	readonly renderBodyKey: RenderBodyKey;
	readonly renderBodyKind: "item" | "header" | "load-more";
	readonly renderBodySectionId: string;
	readonly renderBodySourceKey: string | undefined;
	readonly renderBodyCellKey: string | undefined;
	readonly renderBodyRevision: RenderRevision | undefined;
}

export interface TwoHopRowPlan {
	readonly sectionIndex: number;
	readonly rowIndexInSection: number;
	readonly sectionCellStartIndex: number;
	readonly cellCount: number;
	readonly top: number;
}

/**
 * Struct-of-typed-arrays storage for compiled per-row metadata.
 *
 * Backing the row table with typed arrays keeps recompiles (layout changes,
 * search updates, fold/unfold) off the major-GC sweep path: each recompile
 * allocates a handful of contiguous ArrayBuffers instead of one heap object
 * per row. Hot-path readers below access these arrays directly rather than
 * going through the `plan.rows` facade.
 */
/**
 * Struct-of-typed-arrays storage for compiled per-section prefix metadata.
 *
 * The descriptor-rich `sections` array remains the source for rendering and
 * section identity. Scroll range resolution reads this table directly to keep
 * binary searches and section-boundary math on contiguous numeric buffers.
 */
export interface TwoHopSectionTable {
	readonly sectionCount: number;
	readonly topBySection: Float64Array;
	readonly heightBySection: Float64Array;
	readonly firstRowIndexBySection: Uint32Array;
	readonly rowCountBySection: Uint32Array;
	readonly firstCellIndexBySection: Uint32Array;
	readonly cellCountBySection: Uint32Array;
	readonly visibleCountBySection: Uint32Array;
	readonly showLoadMoreBySection: Uint8Array;
}

export interface TwoHopViewPlan {
	readonly sections: readonly TwoHopSectionPlan[];
	readonly cells: readonly CompiledTwoHopCell[];
	/**
	 * Compiled per-row metadata, indexed by the global row index.
	 *
	 * Lazy arithmetic facade retained for external/test ergonomics.
	 */
	readonly rows: readonly TwoHopRowPlan[];
	readonly sectionTable: TwoHopSectionTable;
	/** Direct, allocation-free row lookup tables used by the scroll hot path. */
	readonly rowSectionIndex: Uint32Array;
	readonly rowFirstCellIndex: Uint32Array;
	readonly rowCellCount: Uint8Array;
	readonly rowTop: Float64Array;
	readonly rowCount: number;
	readonly cellCount: number;
	readonly columns: number;
	readonly rowHeight: number;
	readonly rowGap: number;
	readonly totalHeight: number;
	readonly layout: ViewPlanLayoutMetrics;
}

export interface CompileTwoHopViewPlanParams {
	readonly sections: readonly SectionRenderDescriptor<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[];
	readonly sectionVisibleCounts: Readonly<Record<string, number>>;
	readonly layout: ViewPlanLayoutMetrics;
	resolveInitialSectionVisibleCount(
		section: SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>,
	): number;
	clampVisibleCount(
		section: SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>,
		count: number,
	): number;
}

export interface TwoHopResolvedRow {
	readonly sectionIndex: number;
	readonly rowIndexInSection: number;
	readonly firstCellIndex: number;
	readonly sectionCellStartIndex: number;
	readonly cellCount: number;
	readonly top: number;
}

export interface TwoHopBandRowTops {
	readonly previousStartRowTop: number | null;
	readonly currentStartRowTop: number | null;
	readonly previousEndRowTop: number | null;
	readonly currentEndRowTop: number | null;
}
export type TwoHopBandRowTopsMutable = {
	-readonly [K in keyof TwoHopBandRowTops]: TwoHopBandRowTops[K];
};
export interface ResolveTwoHopRowTopsForBandParams {
	readonly startRow: number;
	readonly endRow: number;
}
export type StablePreviewScrollTopBandMutable = {
	-readonly [K in keyof StablePreviewScrollTopBand]: StablePreviewScrollTopBand[K];
};

export interface FindTwoHopRowsByOffsetParams {
	readonly sectionTable: TwoHopSectionTable;
	readonly rowHeight: number;
	readonly rowGap: number;
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly overscanPx: number;
}

export interface FirstTwoHopRowByTopResolutionScratch {
	rowIndex: number;
	sectionIndex: number;
}
export interface TwoHopViewPlanRowModel extends VirtualRowModel<
	VirtualListLogicalCell<TwoHopVirtualListItem>
> {
	readonly plan: TwoHopViewPlan;
	findVisibleRanges(params: {
		scrollTop: number;
		viewportHeight: number;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangeInto(
		out: RowRange,
		params: {
			scrollTop: number;
			viewportHeight: number;
			overscanPx: number;
		},
	): void;
	findVisibleRangesInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findVisibleRangesFromMounted(params: {
		scrollTop: number;
		viewportHeight: number;
		mounted: RowRange;
		mountedOverscanPx: number;
		previewOverscanPx?: number;
	}): VirtualRanges;
	findVisibleRangesFromMountedInto(
		out: VirtualRanges,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mounted: RowRange;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
		},
	): void;
	findStablePreviewScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			scrollTop: number;
			viewportHeight: number;
			mountedOverscanPx: number;
			previewOverscanPx?: number;
			previewVisible: RowRange;
		},
	): void;
	/**
	 * Computes the scrollTop band within which the mounted range is guaranteed
	 * not to change. Used as a pre-check before the expensive
	 * findVisibleRangeInto call on the active scroll path.
	 *
	 * Unlike findStablePreviewScrollTopBandInto which can return an
	 * infinite band when `previewOverscanPx >= mountedOverscanPx`, this method
	 * always computes a finite band from the actual mounted range boundaries.
	 */
	findStableMountedScrollTopBandInto(
		out: StablePreviewScrollTopBandMutable,
		params: {
			mountedOverscanPx: number;
			viewportHeight: number;
			mounted: RowRange;
		},
	): void;
	resolveRowTopsForBandInto(
		out: TwoHopBandRowTopsMutable,
		params: ResolveTwoHopRowTopsForBandParams,
	): void;
}
