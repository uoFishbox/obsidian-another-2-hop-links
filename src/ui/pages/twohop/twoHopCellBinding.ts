import type { LogicalCellKey } from "ui/components/common/virtual-list/types";
import type { TwoHopMountedCell } from "./twoHopMountedTypes";
import type { TwoHopCellDisplayMetadata } from "./twoHopCellDisplayMetadata";

export {
	resolveTwoHopSectionVariant,
	type TwoHopCardPresentationState,
	type TwoHopCardSectionVariant,
	type TwoHopItemReuseFamily,
} from "./twoHopCellDisplayMetadata";

/** Complete, committed state for one physical cell's current logical binding. */
export interface TwoHopCellBinding extends TwoHopCellDisplayMetadata {
	readonly epoch: number;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderKind: TwoHopMountedCell["renderBodyKind"];
	readonly mountedCell: TwoHopMountedCell;
}

/** Builds the single snapshot committed by a physical slot rebind. */
export function createTwoHopCellBinding(
	cell: TwoHopMountedCell,
	epoch: number,
): TwoHopCellBinding {
	return {
		epoch,
		logicalKey: cell.key,
		rowIndex: cell.rowIndex,
		columnIndex: cell.columnIndex,
		renderKind: cell.renderBodyKind,
		reuseFamily: cell.reuseFamily,
		presentation: cell.presentation,
		interactionId: cell.interactionId,
		mountedCell: cell,
	};
}
