import type { MountedFlatCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";

export type TwoHopMountedCell = MountedFlatCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

export type TwoHopMountedRowSlice = MountedFlatRowSlice<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;
