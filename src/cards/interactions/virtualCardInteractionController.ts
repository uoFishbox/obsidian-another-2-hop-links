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

export interface VirtualCardInteractionController extends InteractionDescriptorResolverProvider {
	getInteractionHandle(slotId: string): InteractionHandle;
	/** Returns true when the set of handles exposed to mounted DOM changed. */
	syncCards(cards: readonly VirtualCardInteractionBinding[]): boolean;
	clear(): void;
}

/** Owns one unique lookup handle for each live virtual card slot. */
export function createVirtualCardInteractionController(): VirtualCardInteractionController {
	const handleBySlot = new Map<string, InteractionHandle>();
	const descriptorByHandle = new Map<InteractionHandle, ItemInteractionDescriptor>();

	return {
		resolveInteractionDescriptor(interactionHandle) {
			return descriptorByHandle.get(interactionHandle) ?? null;
		},
		getInteractionHandle(slotId) {
			const existing = handleBySlot.get(slotId);
			if (existing) return existing;
			const handle = createInteractionHandle("v");
			handleBySlot.set(slotId, handle);
			return handle;
		},
		syncCards(cards) {
			const activeSlotIds = new Set<string>();
			let handlesChanged = false;
			for (const { slotId, descriptor } of cards) {
				activeSlotIds.add(slotId);
				let handle = handleBySlot.get(slotId);
				const previous = handle ? descriptorByHandle.get(handle) : undefined;
				if (
					!handle ||
					(previous &&
						descriptor &&
						previous.interactionId !== descriptor.interactionId)
				) {
					if (handle) descriptorByHandle.delete(handle);
					handle = createInteractionHandle("v");
					handleBySlot.set(slotId, handle);
					handlesChanged = true;
				}
				if (descriptor) descriptorByHandle.set(handle, descriptor);
				else descriptorByHandle.delete(handle);
			}
			for (const slotId of handleBySlot.keys()) {
				if (!activeSlotIds.has(slotId)) {
					descriptorByHandle.delete(handleBySlot.get(slotId)!);
					handleBySlot.delete(slotId);
					handlesChanged = true;
				}
			}
			return handlesChanged;
		},
		clear() {
			handleBySlot.clear();
			descriptorByHandle.clear();
		},
	};
}
