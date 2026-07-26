import type { CardPreviewSnapshot } from "features/preview/ui/cardPreviewSnapshot";
import type {
	RowPreviewBindingDelta,
	RowPreviewCardBinding,
	RowPreviewWindow,
	VirtualPreviewSurface,
} from "features/preview/scheduling/virtualPreviewSurface";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import type {
	VirtualCardInteractionBinding,
	VirtualCardInteractionController,
	VirtualCardInteractionDelta,
} from "ui/interactions/virtualCardInteractionController";
import type { MountedVirtualCell } from "ui/virtualization/types";

/** Display, preview, and interaction data owned by one physical render slot. */
export interface VirtualCardSlotBinding<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
> {
	readonly mountedCell: TMountedCell;
	readonly cardModel?: TCardModel;
	readonly preview?: CardPreviewSnapshot;
	readonly interaction?: ItemInteractionDescriptor;
}

/** Reactive binding state owned by one physical render slot. */
export interface VirtualCardSlotState<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
> {
	binding: VirtualCardSlotBinding<TMountedCell, TCardModel> | undefined;
}

/** Synchronously publishes bindings for a bounded set of physical card slots. */
export interface VirtualCardSlotBindings<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
	TBindingIdentity,
> {
	/** Reconciles card shells, preview bindings, interactions, and preview window. */
	sync(params: {
		readonly mountedCells: readonly TMountedCell[];
		readonly capacity: number;
		readonly bindingIdentity: TBindingIdentity;
		readonly previewWindow: RowPreviewWindow;
	}): void;
	/** Returns the reactive state only while the cell still owns its slot. */
	getSlotState(
		mountedCell: TMountedCell,
	): VirtualCardSlotState<TMountedCell, TCardModel> | undefined;
}

/**
 * Keeps every card concern aligned with the same bounded physical-slot binding.
 */
export function createVirtualCardSlotBindings<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
	TBindingIdentity,
>(options: {
	readonly previewSurface: VirtualPreviewSurface;
	readonly interactionController: VirtualCardInteractionController;
	readonly resolveBinding: (
		mountedCell: TMountedCell,
		bindingIdentity: TBindingIdentity,
	) => VirtualCardSlotBinding<TMountedCell, TCardModel>;
}): VirtualCardSlotBindings<TMountedCell, TCardModel, TBindingIdentity> {
	const slotStates: VirtualCardSlotState<TMountedCell, TCardModel>[] = [];
	const bindingIdentities: (TBindingIdentity | undefined)[] = [];

	const ensureCapacity = (capacity: number): void => {
		while (slotStates.length < capacity) {
			slotStates.push(createVirtualCardSlotState());
		}
	};

	const sync = (params: {
		readonly mountedCells: readonly TMountedCell[];
		readonly capacity: number;
		readonly bindingIdentity: TBindingIdentity;
		readonly previewWindow: RowPreviewWindow;
	}): void => {
		ensureCapacity(params.capacity);
		const retainedSlotIndexes = new Set<number>();
		const enteredPreviewSlots: RowPreviewCardBinding[] = [];
		const reboundPreviewSlots: RowPreviewCardBinding[] = [];
		const releasedPreviewSlots: string[] = [];
		const enteredInteractionSlots: VirtualCardInteractionBinding[] = [];
		const reboundInteractionSlots: VirtualCardInteractionBinding[] = [];
		const releasedInteractionSlots: string[] = [];

		const releaseBinding = (
			slotIndex: number,
			previous: VirtualCardSlotBinding<TMountedCell, TCardModel>,
		): void => {
			const slotId = String(previous.mountedCell.renderSlotKey);
			if (previous.preview) releasedPreviewSlots.push(slotId);
			if (previous.interaction) releasedInteractionSlots.push(slotId);
			slotStates[slotIndex]!.binding = undefined;
			bindingIdentities[slotIndex] = undefined;
		};

		for (const mountedCell of params.mountedCells) {
			const slotIndex = mountedCell.renderSlotIndex;
			retainedSlotIndexes.add(slotIndex);
			const slotState = slotStates[slotIndex];
			if (!slotState) continue;
			const previous = slotState.binding;
			if (
				previous?.mountedCell === mountedCell &&
				bindingIdentities[slotIndex] === params.bindingIdentity
			) {
				continue;
			}

			const next = options.resolveBinding(mountedCell, params.bindingIdentity);
			const slotId = String(mountedCell.renderSlotKey);
			if (next.preview) {
				const previewBinding = {
					slotId,
					rowIndex: mountedCell.rowIndex,
					snapshot: next.preview,
				};
				(previous?.preview ? reboundPreviewSlots : enteredPreviewSlots).push(
					previewBinding,
				);
			} else if (previous?.preview) {
				releasedPreviewSlots.push(slotId);
			}
			if (next.interaction) {
				const interactionBinding = {
					slotId,
					descriptor: next.interaction,
				};
				(previous?.interaction
					? reboundInteractionSlots
					: enteredInteractionSlots
				).push(interactionBinding);
			} else if (previous?.interaction) {
				releasedInteractionSlots.push(slotId);
			}

			slotState.binding = next;
			bindingIdentities[slotIndex] = params.bindingIdentity;
		}

		for (let slotIndex = 0; slotIndex < slotStates.length; slotIndex += 1) {
			if (retainedSlotIndexes.has(slotIndex)) continue;
			const previous = slotStates[slotIndex]?.binding;
			if (previous) releaseBinding(slotIndex, previous);
		}
		if (slotStates.length > params.capacity) {
			slotStates.length = params.capacity;
			bindingIdentities.length = params.capacity;
		}

		const previewDelta: RowPreviewBindingDelta = {
			enteredSlots: enteredPreviewSlots,
			reboundSlots: reboundPreviewSlots,
			releasedSlots: releasedPreviewSlots,
		};
		const interactionDelta: VirtualCardInteractionDelta = {
			enteredSlots: enteredInteractionSlots,
			reboundSlots: reboundInteractionSlots,
			releasedSlots: releasedInteractionSlots,
		};
		options.interactionController.syncCardDelta(interactionDelta);
		options.previewSurface.commitBindingDelta(previewDelta, params.previewWindow);
	};

	return {
		sync,
		getSlotState(mountedCell) {
			const state = slotStates[mountedCell.renderSlotIndex];
			return state?.binding?.mountedCell === mountedCell ? state : undefined;
		},
	};
}

function createVirtualCardSlotState<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
>(): VirtualCardSlotState<TMountedCell, TCardModel> {
	let binding = $state.raw<
		VirtualCardSlotBinding<TMountedCell, TCardModel> | undefined
	>(undefined);
	return {
		get binding() {
			return binding;
		},
		set binding(nextBinding) {
			binding = nextBinding;
		},
	};
}
