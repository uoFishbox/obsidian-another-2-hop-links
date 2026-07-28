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
import type { ResidentSlotBindingToken } from "ui/virtualization/core/residentSlotBinding";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

/** Display, preview, and interaction data owned by one physical render slot. */
export interface VirtualCardSlotBinding<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
> {
	readonly bindingToken: ResidentSlotBindingToken;
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
	/** Publishes only a preview-window change without scanning physical slots. */
	syncPreviewWindow(previewWindow: RowPreviewWindow): void;
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
	) => Omit<VirtualCardSlotBinding<TMountedCell, TCardModel>, "bindingToken">;
}): VirtualCardSlotBindings<TMountedCell, TCardModel, TBindingIdentity> {
	const slotStates: VirtualCardSlotState<TMountedCell, TCardModel>[] = [];
	const bindingIdentities: (TBindingIdentity | undefined)[] = [];
	const bindingEpochs: number[] = [];
	const bindingTokensByCell = new WeakMap<TMountedCell, ResidentSlotBindingToken>();

	const seenGenerationBySlot: number[] = [];
	let syncGeneration = 0;

	const enteredPreviewSlots: RowPreviewCardBinding[] = [];
	const reboundPreviewSlots: RowPreviewCardBinding[] = [];
	const releasedPreviewSlots: string[] = [];
	const enteredInteractionSlots: VirtualCardInteractionBinding[] = [];
	const reboundInteractionSlots: VirtualCardInteractionBinding[] = [];
	const releasedInteractionSlots: string[] = [];

	const ensureCapacity = (capacity: number): void => {
		while (slotStates.length < capacity) {
			const slotIndex = slotStates.length;
			slotStates.push(createVirtualCardSlotState());
			bindingEpochs[slotIndex] ??= 0;
			seenGenerationBySlot[slotIndex] = 0;
		}
	};

	const advanceBinding = (slotIndex: number): ResidentSlotBindingToken => {
		const epoch = (bindingEpochs[slotIndex] ?? 0) + 1;
		bindingEpochs[slotIndex] = epoch;
		return Object.freeze({ slotIndex, epoch });
	};

	const beginSync = (capacity: number): number => {
		syncGeneration += 1;
		if (syncGeneration === Number.MAX_SAFE_INTEGER) {
			seenGenerationBySlot.fill(0);
			syncGeneration = 1;
		}
		ensureCapacity(capacity);
		return syncGeneration;
	};

	const sync = (params: {
		readonly mountedCells: readonly TMountedCell[];
		readonly capacity: number;
		readonly bindingIdentity: TBindingIdentity;
		readonly previewWindow: RowPreviewWindow;
	}): void => {
		const generation = beginSync(params.capacity);
		enteredPreviewSlots.length = 0;
		reboundPreviewSlots.length = 0;
		releasedPreviewSlots.length = 0;
		enteredInteractionSlots.length = 0;
		reboundInteractionSlots.length = 0;
		releasedInteractionSlots.length = 0;
		let changedSlotCount = 0;

		const releaseBinding = (
			slotIndex: number,
			previous: VirtualCardSlotBinding<TMountedCell, TCardModel>,
		): void => {
			const slotId = String(previous.mountedCell.renderSlotKey);
			if (previous.preview) releasedPreviewSlots.push(slotId);
			if (previous.interaction) releasedInteractionSlots.push(slotId);
			advanceBinding(slotIndex);
			slotStates[slotIndex]!.binding = undefined;
			bindingIdentities[slotIndex] = undefined;
		};

		for (const mountedCell of params.mountedCells) {
			const slotIndex = mountedCell.renderSlotIndex;
			const slotState = slotStates[slotIndex];
			if (!slotState) continue;
			seenGenerationBySlot[slotIndex] = generation;
			const previous = slotState.binding;
			if (
				previous &&
				hasSameMountedCellBinding(previous.mountedCell, mountedCell) &&
				bindingIdentities[slotIndex] === params.bindingIdentity
			) {
				bindingTokensByCell.set(mountedCell, previous.bindingToken);
				continue;
			}

			const resolved = options.resolveBinding(
				mountedCell,
				params.bindingIdentity,
			);
			changedSlotCount += 1;
			const retainsLogicalBinding =
				previous &&
				hasSameMountedCellBinding(previous.mountedCell, mountedCell);
			const next: VirtualCardSlotBinding<TMountedCell, TCardModel> = {
				...resolved,
				bindingToken: retainsLogicalBinding
					? previous.bindingToken
					: advanceBinding(slotIndex),
			};
			bindingTokensByCell.set(mountedCell, next.bindingToken);
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
			if (seenGenerationBySlot[slotIndex] === generation) continue;
			const previous = slotStates[slotIndex]?.binding;
			if (previous) releaseBinding(slotIndex, previous);
		}
		if (slotStates.length > params.capacity) {
			slotStates.length = params.capacity;
			bindingIdentities.length = params.capacity;
			seenGenerationBySlot.length = params.capacity;
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

		if (process.env.NODE_ENV !== "production") {
			recordCCLDevMeasurement("twoHop.cardSlotBindings.sync");
			for (let i = 0; i < params.mountedCells.length; i++) {
				recordCCLDevMeasurement("twoHop.cardSlotBindings.scannedSlots");
			}
			for (let i = 0; i < changedSlotCount; i++) {
				recordCCLDevMeasurement("twoHop.cardSlotBindings.changedSlots");
			}
		}
	};

	return {
		sync,
		syncPreviewWindow(previewWindow) {
			options.previewSurface.setPreviewWindow(previewWindow);
		},
		getSlotState(mountedCell) {
			const token = bindingTokensByCell.get(mountedCell);
			if (!token) return undefined;
			const state = slotStates[token.slotIndex];
			const current = state?.binding?.bindingToken;
			if (!current || current.epoch !== token.epoch) return undefined;
			return state;
		},
	};
}

function hasSameMountedCellBinding(
	current: MountedVirtualCell,
	next: MountedVirtualCell,
): boolean {
	return (
		current.key === next.key &&
		current.renderSlotIndex === next.renderSlotIndex &&
		current.rowIndex === next.rowIndex &&
		current.columnIndex === next.columnIndex
	);
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
