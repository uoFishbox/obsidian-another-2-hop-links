import { createSectionHeaderInteractionKey } from "ui/interactions/interactionTypes";
import { createInteractionTokenAllocator } from "ui/interactions/interactionRegistry";

export interface TwoHopInteractionTokenAllocator {
	readonly createItemInteractionToken: (semanticKey: string) => string;
	readonly createHeaderInteractionToken: (sectionId: string) => string;
}

export function createTwoHopInteractionTokenAllocator(): TwoHopInteractionTokenAllocator {
	const createItemInteractionToken = createInteractionTokenAllocator("i");
	const allocateHeaderInteractionToken = createInteractionTokenAllocator("h");

	return {
		createItemInteractionToken,
		createHeaderInteractionToken: (sectionId) =>
			allocateHeaderInteractionToken(
				createSectionHeaderInteractionKey(sectionId),
			),
	};
}
