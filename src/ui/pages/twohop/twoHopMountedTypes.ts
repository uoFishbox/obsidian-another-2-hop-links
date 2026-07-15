import type {
	MountedFlatCell,
	MountedFlatItemCell,
} from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualListSection,
} from "./twoHopVirtualListModel";
import type { TwoHopCellDisplayMetadata } from "./twoHopCellDisplayMetadata";

export type TwoHopMountedCell = MountedFlatCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
> &
	TwoHopCellDisplayMetadata;

export type TwoHopMountedItemCell = MountedFlatItemCell<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
> &
	TwoHopCellDisplayMetadata;

type TwoHopMountedRowSliceBase = MountedFlatRowSlice<
	TwoHopVirtualListItem,
	TwoHopVirtualListSection
>;

export type TwoHopMountedRowSlice = Omit<TwoHopMountedRowSliceBase, "cells"> & {
	cells: TwoHopMountedCell[];
};
