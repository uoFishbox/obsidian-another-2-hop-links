import type { CompiledTwoHopCell, TwoHopSectionPlan } from "./twoHopViewPlan";

export type {
	TwoHopCardPresentationState,
	TwoHopCardSectionVariant,
	TwoHopItemReuseFamily,
} from "./twoHopCellStaticState";

/** Minimal immutable binding committed to one physical cell slot. */
export interface TwoHopCellBinding {
	readonly epoch: number;
	readonly logicalRowIndex: number;
	readonly columnIndex: number;
	readonly compiledCell: CompiledTwoHopCell;
}

/** The single reactive value committed for one physical row slot. */
export interface TwoHopRowSlotFrame {
	readonly epoch: number;
	readonly slotIndex: number;
	readonly logicalRowIndex: number;
	readonly top: number;
	readonly sectionPlan: TwoHopSectionPlan;
	readonly cells: readonly TwoHopCellBinding[];
}

/** Current resident cell together with its row-owned section data. */
export interface TwoHopResidentCell {
	readonly binding: TwoHopCellBinding;
	readonly rowFrame: TwoHopRowSlotFrame;
}

export type TwoHopItemCellBinding = TwoHopCellBinding & {
	readonly compiledCell: CompiledTwoHopCell & {
		readonly logicalCell: Extract<
			CompiledTwoHopCell["logicalCell"],
			{ kind: "item" }
		>;
	};
};

export { resolveTwoHopSectionVariant } from "./twoHopCellStaticState";

/** Creates a binding without copying compiled render state. */
export function createTwoHopCellBinding(params: {
	readonly compiledCell: CompiledTwoHopCell;
	readonly logicalRowIndex: number;
	readonly columnIndex: number;
	readonly epoch: number;
}): TwoHopCellBinding {
	return {
		epoch: params.epoch,
		logicalRowIndex: params.logicalRowIndex,
		columnIndex: params.columnIndex,
		compiledCell: params.compiledCell,
	};
}
