import {
	createSectionHeaderInteractionKey,
	type SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import { createInteractionTokenAllocator } from "ui/interactions/interactionRegistry";

export interface HeaderInteractionIdentity {
	readonly interactionId: string;
	readonly interactionKey: string;
}

export interface TwoHopInteractionTokenAllocator {
	readonly createItemInteractionToken: (interactionKey: string) => string;
	readonly createHeaderInteractionIdentity: (
		sectionId: string,
	) => HeaderInteractionIdentity;
}

export interface HeaderInteractionDescriptorFactoryParams<TSnapshot> {
	readonly sectionId: string;
	readonly snapshot: TSnapshot;
	readonly createDescriptor: (
		sectionId: string,
		snapshot: TSnapshot,
		options: HeaderInteractionIdentity,
	) => SectionHeaderInteractionDescriptor;
}

export function createTwoHopInteractionTokenAllocator(): TwoHopInteractionTokenAllocator {
	const createItemInteractionToken = createInteractionTokenAllocator("i");
	const createHeaderInteractionToken = createInteractionTokenAllocator("h");

	return {
		createItemInteractionToken,
		createHeaderInteractionIdentity(sectionId) {
			const interactionKey = createSectionHeaderInteractionKey(sectionId);
			return {
				interactionId: createHeaderInteractionToken(interactionKey),
				interactionKey,
			};
		},
	};
}
