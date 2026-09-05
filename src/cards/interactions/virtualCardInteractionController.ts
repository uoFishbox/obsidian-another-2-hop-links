import {
	createInteractionHandle,
	type InteractionHandle,
	type ItemInteractionDescriptor,
} from "./interactionTypes";
import type { InteractionDescriptorResolverProvider } from "./interactionRegistry";

export interface VirtualCardInteractionBinding {
	readonly slotId: string;
	/** Null while the live DOM slot is mounted but its card is not hydrated. */
	descriptor: ItemInteractionDescriptor | null;
}

export interface VirtualCardInteractionController {
	readonly provider: InteractionDescriptorResolverProvider;
	getInteractionHandle(slotId: string): InteractionHandle;
	/** Returns true when the set of handles exposed to mounted DOM changed. */
	syncCards(cards: readonly VirtualCardInteractionBinding[]): boolean;
	clear(): void;
}

interface VirtualCardInteractionSlotBinding {
	readonly handle: InteractionHandle;
	readonly descriptor: ItemInteractionDescriptor | null;
}

/** Owns one unique lookup handle for each live virtual card slot. */
export function createVirtualCardInteractionController(): VirtualCardInteractionController {
	const bindingBySlot = new Map<string, VirtualCardInteractionSlotBinding>();
	const descriptorByHandle = new Map<InteractionHandle, ItemInteractionDescriptor>();

	function createSlotBinding(
		descriptor: ItemInteractionDescriptor | null,
	): VirtualCardInteractionSlotBinding {
		return {
			handle: createInteractionHandle("v"),
			descriptor,
		};
	}

	function getInteractionHandle(slotId: string): InteractionHandle {
		const existing = bindingBySlot.get(slotId);
		if (existing) return existing.handle;

		const binding = createSlotBinding(null);
		bindingBySlot.set(slotId, binding);
		return binding.handle;
	}

	function removeSlot(slotId: string): boolean {
		const binding = bindingBySlot.get(slotId);
		if (!binding) return false;
		bindingBySlot.delete(slotId);
		descriptorByHandle.delete(binding.handle);
		return true;
	}

	function bindCard(
		slotId: string,
		descriptor: ItemInteractionDescriptor,
	): boolean {
		const previous = bindingBySlot.get(slotId);
		let binding: VirtualCardInteractionSlotBinding;
		if (
			previous &&
			(previous.descriptor === null ||
				previous.descriptor.interactionId === descriptor.interactionId)
		) {
			binding = { handle: previous.handle, descriptor };
		} else {
			binding = createSlotBinding(descriptor);
		}
		if (previous && previous.handle !== binding.handle) {
			descriptorByHandle.delete(previous.handle);
		}
		bindingBySlot.set(slotId, binding);
		descriptorByHandle.set(binding.handle, descriptor);
		return previous?.handle !== binding.handle;
	}

	function bindEmptySlot(slotId: string): boolean {
		const previous = bindingBySlot.get(slotId);
		if (!previous) {
			bindingBySlot.set(slotId, createSlotBinding(null));
			return true;
		}

		descriptorByHandle.delete(previous.handle);
		bindingBySlot.set(slotId, {
			handle: previous.handle,
			descriptor: null,
		});
		return false;
	}

	const provider: InteractionDescriptorResolverProvider = {
		resolveInteractionDescriptor(interactionHandle) {
			return descriptorByHandle.get(interactionHandle) ?? null;
		},
	};

	return {
		provider,
		getInteractionHandle,
		syncCards(cards) {
			const activeSlotIds = new Set<string>();
			let handlesChanged = false;
			for (const card of cards) {
				activeSlotIds.add(card.slotId);
				handlesChanged = card.descriptor
					? bindCard(card.slotId, card.descriptor) || handlesChanged
					: bindEmptySlot(card.slotId) || handlesChanged;
			}
			for (const slotId of bindingBySlot.keys()) {
				if (!activeSlotIds.has(slotId)) {
					handlesChanged = removeSlot(slotId) || handlesChanged;
				}
			}
			return handlesChanged;
		},
		clear() {
			bindingBySlot.clear();
			descriptorByHandle.clear();
		},
	};
}
