import {
	createInteractionHandle,
	type InteractionHandle,
	type ItemInteractionDescriptor,
} from "./interactionTypes";
import type { InteractionDescriptorResolverProvider } from "./interactionRegistry";

export interface VirtualCardInteractionBinding {
	readonly slotId: string;
	descriptor: ItemInteractionDescriptor;
}

export interface VirtualCardInteractionController {
	readonly provider: InteractionDescriptorResolverProvider;
	getInteractionHandle(slotId: string): InteractionHandle;
	syncCards(cards: readonly VirtualCardInteractionBinding[]): void;
	setCard(slotId: string, descriptor: ItemInteractionDescriptor | null): void;
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

	function removeSlot(slotId: string): void {
		const binding = bindingBySlot.get(slotId);
		if (!binding) return;
		bindingBySlot.delete(slotId);
		descriptorByHandle.delete(binding.handle);
	}

	function bindCard(slotId: string, descriptor: ItemInteractionDescriptor): void {
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
			for (const card of cards) {
				activeSlotIds.add(card.slotId);
				bindCard(card.slotId, card.descriptor);
			}
			for (const slotId of bindingBySlot.keys()) {
				if (!activeSlotIds.has(slotId)) removeSlot(slotId);
			}
		},
		setCard(slotId, descriptor) {
			if (descriptor) {
				bindCard(slotId, descriptor);
			} else {
				removeSlot(slotId);
			}
		},
		clear() {
			bindingBySlot.clear();
			descriptorByHandle.clear();
		},
	};
}
