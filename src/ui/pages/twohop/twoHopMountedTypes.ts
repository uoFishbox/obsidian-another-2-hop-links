import type { MountedFlatCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { CompiledTwoHopCell } from "./twoHopViewPlan/types";

export type TwoHopMountedCell = MountedFlatCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
> & {
	readonly compiledCell?: CompiledTwoHopCell;
};

export type TwoHopMountedRowSlice = MountedFlatRowSlice<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
