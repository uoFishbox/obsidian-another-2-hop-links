import type { ItemInteractionDescriptor } from "./interactionTypes";
import type { InteractionDescriptorResolverProvider } from "./interactionRegistry";

export interface VirtualCardInteractionBinding {
	readonly slotId: string;
	descriptor: ItemInteractionDescriptor;
}

export interface VirtualCardInteractionDelta {
	readonly enteredSlots: readonly VirtualCardInteractionBinding[];
	readonly reboundSlots: readonly VirtualCardInteractionBinding[];
	readonly releasedSlots: readonly string[];
}

export interface VirtualCardInteractionController {
	readonly provider: InteractionDescriptorResolverProvider;
	syncCards(cards: readonly VirtualCardInteractionBinding[]): void;
	syncCardDelta(delta: VirtualCardInteractionDelta): void;
	clear(): void;
}

/** Keeps one interaction registry entry per bounded physical card slot. */
export function createVirtualCardInteractionController(): VirtualCardInteractionController {
	const descriptorsBySlot = new Map<string, ItemInteractionDescriptor>();
	const interactionIdBySlot = new Map<string, string>();
	const descriptorByInteractionId = new Map<string, ItemInteractionDescriptor>();
	const retainedSlots = new Set<string>();

	function removeSlot(slotId: string) {
		const prevId = interactionIdBySlot.get(slotId);
		if (prevId !== undefined) {
			descriptorByInteractionId.delete(prevId);
			interactionIdBySlot.delete(slotId);
		}
		descriptorsBySlot.delete(slotId);
	}

	function bindCard(card: VirtualCardInteractionBinding): void {
		const prevId = interactionIdBySlot.get(card.slotId);
		if (prevId !== undefined && prevId !== card.descriptor.interactionId) {
			descriptorByInteractionId.delete(prevId);
		}
		descriptorsBySlot.set(card.slotId, card.descriptor);
		interactionIdBySlot.set(card.slotId, card.descriptor.interactionId);
		descriptorByInteractionId.set(card.descriptor.interactionId, card.descriptor);
	}

	const provider: InteractionDescriptorResolverProvider = {
		resolveInteractionDescriptor(interactionId) {
			return descriptorByInteractionId.get(interactionId) ?? null;
		},
	};

	return {
		provider,
		syncCards(cards) {
			retainedSlots.clear();
			for (const card of cards) {
				retainedSlots.add(card.slotId);
				bindCard(card);
			}
			for (const slotId of descriptorsBySlot.keys()) {
				if (!retainedSlots.has(slotId)) removeSlot(slotId);
			}
			retainedSlots.clear();
		},
		syncCardDelta(delta) {
			for (const slotId of delta.releasedSlots) removeSlot(slotId);
			for (const card of delta.enteredSlots) bindCard(card);
			for (const card of delta.reboundSlots) bindCard(card);
		},
		clear() {
			descriptorsBySlot.clear();
			interactionIdBySlot.clear();
			descriptorByInteractionId.clear();
			retainedSlots.clear();
		},
	};
}
