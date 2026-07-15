import type { LogicalCellKey } from "ui/components/common/virtual-list/types";
import type { TwoHopMountedCell } from "./twoHopMountedTypes";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import {
	resolveTwoHopItemStaticState,
	type TwoHopCardPresentationState,
	type TwoHopCellStaticState,
	type TwoHopItemReuseFamily,
} from "./twoHopCellStaticState";

export type {
	TwoHopCardPresentationState,
	TwoHopCardSectionVariant,
	TwoHopItemReuseFamily,
} from "./twoHopCellStaticState";

/** Complete, committed state for one physical cell's current logical binding. */
export interface TwoHopCellBinding {
	readonly epoch: number;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderKind: TwoHopMountedCell["renderBodyKind"];
	readonly reuseFamily: TwoHopItemReuseFamily | null;
	readonly presentation: TwoHopCardPresentationState | null;
	readonly interactionId: string | null;
	readonly mountedCell: TwoHopMountedCell;
}

export { resolveTwoHopSectionVariant } from "./twoHopCellStaticState";

function resolveStaticState(cell: TwoHopMountedCell): TwoHopCellStaticState {
	if (cell.compiledCell?.logicalKey === cell.key) return cell.compiledCell;
	if (cell.cell.kind === "item") {
		return resolveTwoHopItemStaticState(cell.cell.item, cell.section);
	}

	return { reuseFamily: null, presentation: null, interactionId: null };
}

/** Builds the single snapshot committed by a physical slot rebind. */
export function createTwoHopCellBinding(
	cell: TwoHopMountedCell,
	epoch: number,
): TwoHopCellBinding {
	const mountedCell = {
		...cell,
		cell: { ...cell.cell },
	} as TwoHopMountedCell;
	const staticState = resolveStaticState(mountedCell);

	return {
		epoch,
		logicalKey: mountedCell.key,
		rowIndex: mountedCell.rowIndex,
		columnIndex: mountedCell.columnIndex,
		renderBodyKey: mountedCell.renderBodyKey,
		renderKind: mountedCell.renderBodyKind,
		...staticState,
		mountedCell,
	};
}
