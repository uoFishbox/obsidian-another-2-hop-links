import type { VirtualCellBodyLifecyclePolicy } from "ui/virtualization/bodyLifecycle";
import type { TwoHopFixedCellSlotController } from "./twoHopPhysicalSlotStore.svelte";

/** Keeps compatible item bodies resident while keying structural bodies logically. */
export const TWO_HOP_BODY_LIFECYCLE_POLICY: VirtualCellBodyLifecyclePolicy<TwoHopFixedCellSlotController> = {
	type: "keyed",
	resolveKey(cellController) {
		const compiledCell = cellController.binding?.compiledCell;
		if (!compiledCell) return cellController.renderSlotKey;
		if (compiledCell.renderBodyKind === "item") {
			return `twohop-item:${compiledCell.reuseFamily ?? "resolved-card"}`;
		}

		return `${compiledCell.renderBodyKind}:${compiledCell.renderBodyKey ?? compiledCell.logicalKey}`;
	},
};
