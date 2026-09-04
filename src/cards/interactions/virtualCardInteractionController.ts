import type { ItemInteractionDescriptor } from "./interactionTypes";
import type { InteractionDescriptorResolverProvider } from "./interactionRegistry";

export interface VirtualCardInteractionBinding {
	readonly slotId: string;
	descriptor: ItemInteractionDescriptor;
}

export interface VirtualCardInteractionController {
	readonly provider: InteractionDescriptorResolverProvider;
	syncCards(cards: readonly VirtualCardInteractionBinding[]): void;
	setCard(slotId: string, descriptor: ItemInteractionDescriptor | null): void;
	clear(): void;
}

/** Keeps one interaction registry entry per bounded physical card slot. */
export function createVirtualCardInteractionController(): VirtualCardInteractionController {
	const interactionIdBySlot = new Map<string, string>();
	const descriptorByInteractionId = new Map<string, ItemInteractionDescriptor>();

	function removeSlot(slotId: string) {
		const prevId = interactionIdBySlot.get(slotId);
		if (prevId !== undefined) {
			descriptorByInteractionId.delete(prevId);
			interactionIdBySlot.delete(slotId);
		}
	}

	function bindCard(slotId: string, descriptor: ItemInteractionDescriptor): void {
		const prevId = interactionIdBySlot.get(slotId);
		if (prevId !== undefined && prevId !== descriptor.interactionId) {
			descriptorByInteractionId.delete(prevId);
		}
		interactionIdBySlot.set(slotId, descriptor.interactionId);
		descriptorByInteractionId.set(descriptor.interactionId, descriptor);
	}

	const provider: InteractionDescriptorResolverProvider = {
		resolveInteractionDescriptor(interactionId) {
			return descriptorByInteractionId.get(interactionId) ?? null;
		},
	};

	return {
		provider,
		syncCards(cards) {
			interactionIdBySlot.clear();
			descriptorByInteractionId.clear();
			for (const card of cards) {
				interactionIdBySlot.set(card.slotId, card.descriptor.interactionId);
				descriptorByInteractionId.set(
					card.descriptor.interactionId,
					card.descriptor,
				);
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
			interactionIdBySlot.clear();
			descriptorByInteractionId.clear();
		},
	};
}
