import type { RowRange } from "ui/components/common/virtual-list/rowRange";
import type { VirtualRanges } from "ui/components/common/virtual-list/types";
import type { MountedFlatCell } from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/reconciliation/viewPlanRenderRows";
import {
	buildSectionedGridMountedRows,
	type SectionedGridMountedRowsBuild,
} from "ui/components/common/virtual-list/row-models/sectionedGridMountedRows";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "./twohopPageVirtualModel";
import {
	ensureTwoHopMountedRangeMaterialized,
	findTwoHopSectionIndexByRow,
	readTwoHopLogicalCellInSection,
	resolveTwoHopRowInSection,
	resolveTwoHopRowInSectionInto,
	type TwoHopViewPlan,
	type TwoHopViewPlanRowModel,
} from "./twoHopViewPlan";

export type TwoHopMountedRowsBuild = SectionedGridMountedRowsBuild<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
	TwoHopViewPlan
>;

export type TwoHopMountedCell = MountedFlatCell<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection
>;

export type TwoHopMountedRowSlice = MountedFlatRowSlice<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection
>;

/**
 * Assigns compiled TwoHop cells directly to pooled surface slots.
 */
export function buildTwoHopMountedRows(params: {
	readonly rowModel: TwoHopViewPlanRowModel;
	readonly rowRange: RowRange;
	readonly ranges: VirtualRanges;
	readonly previousBuild?: TwoHopMountedRowsBuild;
	readonly reusableRowSlotsScratch?: number[];
}): TwoHopMountedRowsBuild {
	// Materialize the cells for the mounted range before the pure builder
	// reads them, so the generic builder has a single responsibility: convert
	// a row range into mounted rows.
	ensureTwoHopMountedRangeMaterialized(params.rowModel.plan, params.rowRange);
	return buildSectionedGridMountedRows({
		plan: params.rowModel.plan,
		rowRange: params.rowRange,
		previousBuild: params.previousBuild,
		reusableRowSlotsScratch: params.reusableRowSlotsScratch,
		findSectionIndexByRow: findTwoHopSectionIndexByRow,
		resolveRowInSection: resolveTwoHopRowInSection,
		resolveRowInSectionInto: resolveTwoHopRowInSectionInto,
		readLogicalCellInSection: readTwoHopLogicalCellInSection,
	});
}
