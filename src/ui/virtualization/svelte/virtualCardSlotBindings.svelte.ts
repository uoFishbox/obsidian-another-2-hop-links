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
import {
	hasSameCellSlotIncarnation,
	type ResidentCellSlotIncarnation,
} from "ui/virtualization/core/residentSlotBinding";
import {
	recordCCLDevMeasurement,
	recordCCLDevMeasurementCount,
} from "infrastructure/debug/CCLDevMeasurements";

/** Display, preview, and interaction data owned by one physical render slot. */
export interface VirtualCardSlotBinding<
	TMountedCell extends MountedVirtualCell,
	TCardModel,
> {
	readonly bindingToken: ResidentCellSlotIncarnation;
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
	readonly resolveCellIncarnation: (
		mountedCell: TMountedCell,
	) => ResidentCellSlotIncarnation;
	readonly resolvePublicationRevision: (mountedCell: TMountedCell) => unknown;
	readonly resolveBinding: (
		mountedCell: TMountedCell,
		bindingIdentity: TBindingIdentity,
	) => Omit<VirtualCardSlotBinding<TMountedCell, TCardModel>, "bindingToken">;
}): VirtualCardSlotBindings<TMountedCell, TCardModel, TBindingIdentity> {
	const slotStates = new Map<
		number,
		VirtualCardSlotState<TMountedCell, TCardModel>
	>();
	const bindingIdentities = new Map<number, TBindingIdentity>();
	const publicationRevisions = new Map<number, unknown>();
	const bindingTokensByCell = new WeakMap<
		TMountedCell,
		ResidentCellSlotIncarnation
	>();
	let activeSlotIndices = new Set<number>();

	const enteredPreviewSlots: RowPreviewCardBinding[] = [];
	const reboundPreviewSlots: RowPreviewCardBinding[] = [];
	const releasedPreviewSlots: string[] = [];
	const enteredInteractionSlots: VirtualCardInteractionBinding[] = [];
	const reboundInteractionSlots: VirtualCardInteractionBinding[] = [];
	const releasedInteractionSlots: string[] = [];

	const sync = (params: {
		readonly mountedCells: readonly TMountedCell[];
		readonly bindingIdentity: TBindingIdentity;
		readonly previewWindow: RowPreviewWindow;
	}): void => {
		enteredPreviewSlots.length = 0;
		reboundPreviewSlots.length = 0;
		releasedPreviewSlots.length = 0;
		enteredInteractionSlots.length = 0;
		reboundInteractionSlots.length = 0;
		releasedInteractionSlots.length = 0;
		let changedSlotCount = 0;
		const nextActiveSlotIndices = new Set<number>();

		const releaseBinding = (
			slotIndex: number,
			previous: VirtualCardSlotBinding<TMountedCell, TCardModel>,
		): void => {
			const slotId = String(previous.mountedCell.renderSlotKey);
			if (previous.preview) releasedPreviewSlots.push(slotId);
			if (previous.interaction) releasedInteractionSlots.push(slotId);
			slotStates.get(slotIndex)!.binding = undefined;
			slotStates.delete(slotIndex);
			bindingIdentities.delete(slotIndex);
			publicationRevisions.delete(slotIndex);
		};

		for (const mountedCell of params.mountedCells) {
			const bindingToken = options.resolveCellIncarnation(mountedCell);
			const slotIndex = bindingToken.cellSlotIndex;
			assertCellIncarnation(mountedCell, bindingToken, nextActiveSlotIndices);
			nextActiveSlotIndices.add(slotIndex);
			let slotState = slotStates.get(slotIndex);
			if (!slotState) {
				slotState = createVirtualCardSlotState();
				slotStates.set(slotIndex, slotState);
			}
			const previous = slotState.binding;
			const publicationRevision = options.resolvePublicationRevision(mountedCell);
			const retainsSlotLease =
				previous !== undefined &&
				hasSameCellSlotIncarnation(previous.bindingToken, bindingToken);
			const retainsLogicalOwner =
				previous !== undefined && previous.mountedCell.key === mountedCell.key;
			const effectiveBindingToken = retainsSlotLease
				? previous.bindingToken
				: bindingToken;
			if (
				previous &&
				retainsSlotLease &&
				retainsLogicalOwner &&
				Object.is(publicationRevisions.get(slotIndex), publicationRevision) &&
				bindingIdentities.get(slotIndex) === params.bindingIdentity
			) {
				bindingTokensByCell.set(mountedCell, effectiveBindingToken);
				if (previous.mountedCell !== mountedCell) {
					slotState.binding = {
						...previous,
						bindingToken: effectiveBindingToken,
						mountedCell,
					};
				}
				continue;
			}

			const resolved = options.resolveBinding(
				mountedCell,
				params.bindingIdentity,
			);
			changedSlotCount += 1;
			const next: VirtualCardSlotBinding<TMountedCell, TCardModel> = {
				...resolved,
				bindingToken: effectiveBindingToken,
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
			bindingIdentities.set(slotIndex, params.bindingIdentity);
			publicationRevisions.set(slotIndex, publicationRevision);
		}

		for (const slotIndex of activeSlotIndices) {
			if (nextActiveSlotIndices.has(slotIndex)) continue;
			const previous = slotStates.get(slotIndex)?.binding;
			if (previous) releaseBinding(slotIndex, previous);
		}
		activeSlotIndices = nextActiveSlotIndices;

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
			recordCCLDevMeasurementCount(
				"twoHop.cardSlotBindings.scannedSlots",
				params.mountedCells.length,
			);
			recordCCLDevMeasurementCount(
				"twoHop.cardSlotBindings.changedSlots",
				changedSlotCount,
			);
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
			const state = slotStates.get(token.cellSlotIndex);
			if (state?.binding?.mountedCell !== mountedCell) return undefined;
			const current = state?.binding?.bindingToken;
			if (!current || !hasSameCellSlotIncarnation(current, token)) {
				return undefined;
			}
			return state;
		},
	};
}

function assertCellIncarnation(
	mountedCell: MountedVirtualCell,
	incarnation: ResidentCellSlotIncarnation,
	activeSlotIndices: ReadonlySet<number>,
): void {
	if (process.env.NODE_ENV === "production") return;
	if (incarnation.cellSlotIndex !== mountedCell.renderSlotIndex) {
		throw new Error(
			`Card incarnation slot ${incarnation.cellSlotIndex} does not match render slot ${mountedCell.renderSlotIndex}.`,
		);
	}
	if (activeSlotIndices.has(incarnation.cellSlotIndex)) {
		throw new Error(
			`Duplicate active card cell slot: ${incarnation.cellSlotIndex}.`,
		);
	}
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
