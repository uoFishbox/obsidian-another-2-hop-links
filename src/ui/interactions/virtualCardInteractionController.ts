import type { ItemInteractionDescriptor } from "./interactionTypes";
import type { InteractionDescriptorResolverProvider } from "./interactionRegistry";

export interface VirtualCardInteractionBinding {
	readonly slotId: string;
	readonly descriptor: ItemInteractionDescriptor;
}

export interface VirtualCardInteractionController {
	readonly provider: InteractionDescriptorResolverProvider;
	syncCards(cards: readonly VirtualCardInteractionBinding[]): void;
	clear(): void;
}

/** Keeps one interaction registry entry per bounded physical card slot. */
export function createVirtualCardInteractionController(): VirtualCardInteractionController {
	const descriptorsBySlot = new Map<string, ItemInteractionDescriptor>();
	const retainedSlots = new Set<string>();

	const provider: InteractionDescriptorResolverProvider = {
		resolveInteractionDescriptor(interactionId) {
			for (const descriptor of descriptorsBySlot.values()) {
				if (descriptor.interactionId === interactionId) return descriptor;
			}
			return null;
		},
	};

	return {
		provider,
		syncCards(cards) {
			retainedSlots.clear();
			for (const card of cards) {
				retainedSlots.add(card.slotId);
				descriptorsBySlot.set(card.slotId, card.descriptor);
			}
			for (const slotId of descriptorsBySlot.keys()) {
				if (!retainedSlots.has(slotId)) descriptorsBySlot.delete(slotId);
			}
			retainedSlots.clear();
		},
		clear() {
			descriptorsBySlot.clear();
			retainedSlots.clear();
		},
	};
}
