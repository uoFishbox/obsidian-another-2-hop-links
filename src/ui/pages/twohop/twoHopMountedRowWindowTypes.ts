import type { MountedFlatCell } from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
import type {
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection,
} from "./twohopPageVirtualModel";

export type TwoHopMountedCell = MountedFlatCell<
	TwoHopPageVirtualItem,
	TwoHopPageVirtualSection
>;
