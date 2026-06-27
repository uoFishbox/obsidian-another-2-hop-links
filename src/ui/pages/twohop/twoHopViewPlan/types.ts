import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
import type { SectionRenderDescriptor } from "ui/components/sections/types";
import type { VirtualListLogicalCell } from "ui/components/common/virtual-list/logicalCell";
import type { ViewPlanLayoutMetrics } from "ui/components/common/virtual-list/svelte/viewPlanLayout";
import type { StablePreviewScrollTopBand } from "ui/components/common/virtual-list/dom/activeScrollWindowGate";
import type {
	VirtualNavigationTarget,
	VirtualRanges,
	VirtualRowModel,
} from "ui/components/common/virtual-list/types";
import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { SectionLayout } from "ui/components/common/virtual-list/layout/viewPlanRowTypes";
import type {
	TwoHopVirtualListSection,
	TwoHopVirtualListItem,
} from "../twoHopVirtualListModel";
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

/**
 * Per-section progress for background materialization.
 *
 * `nextCellIndex` is the background walk cursor: the next section-local cell
 * the background materializer will inspect. It only advances and never
 * reflects cells filled out-of-band.
 *
 * `materializedCellCount` is the number of cells in this section that are
 * currently materialized (cache filled) by *anyone* — synchronous
 * scroll-driven materialization or the background materializer alike. It is
 * updated at the single transition point where a cell goes from empty to
 * filled, so both paths share one source of truth and the background loop
 * never re-counts cells already filled by the scroll path.
 */
export interface TwoHopSectionMaterializationState {
	nextCellIndex: number;
	materializedCellCount: number;
}

export interface TwoHopCellStore {
	readonly logicalCellsBySectionIndex: Array<
		Array<VirtualListLogicalCell<TwoHopVirtualListItem> | undefined>
	>;
	readonly materializationStateBySectionIndex: TwoHopSectionMaterializationState[];
	readonly materializedSectionByIndex: boolean[];
	nextUnmaterializedSectionIndex: number;
	remainingUnmaterializedCellCount: number;
	remainingUnmaterializedSectionCount: number;
	revision: number;
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
export interface TwoHopRowTable {
	readonly rowCount: number;
	readonly sectionIndexByRow: Int32Array;
	readonly rowIndexInSectionByRow: Int32Array;
	readonly sectionCellStartByRow: Int32Array;
	readonly cellCountByRow: Uint16Array;
	readonly topByRow: Float64Array;
}

export interface TwoHopViewPlan {
	readonly sections: readonly TwoHopSectionPlan[];
	/**
	 * Compiled per-row metadata, indexed by the global row index.
	 *
	 * This is a lazy facade over {@link TwoHopViewPlan.rowTable}: each index
	 * access materializes a fresh `TwoHopRowPlan` snapshot. It is retained for
	 * external/test ergonomics; the scroll hot path reads `rowTable` directly
	 * to avoid per-access allocation.
	 */
	readonly rows: readonly TwoHopRowPlan[];
	readonly rowTable: TwoHopRowTable;
	readonly rowCount: number;
	readonly cellCount: number;
	readonly columns: number;
	readonly rowHeight: number;
	readonly rowGap: number;
	readonly totalHeight: number;
	readonly layout: ViewPlanLayoutMetrics;
	readonly cellStore: TwoHopCellStore;
}

export type TwoHopViewPlanMaterialization =
	| { readonly kind: "eager" }
	| {
			readonly kind: "batched";
			readonly initial: {
				readonly maxSectionCount: number;
				readonly maxCellCount: number;
			};
			readonly background: {
				readonly maxCellCountPerSlice: number;
			};
	  };

export interface CompileTwoHopViewPlanParams {
	readonly sections: readonly SectionRenderDescriptor<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>[];
	readonly sectionVisibleCounts: Readonly<Record<string, number>>;
	readonly layout: ViewPlanLayoutMetrics;
	readonly materialization?: TwoHopViewPlanMaterialization;
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
	readonly sections: readonly TwoHopSectionPlan[];
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
