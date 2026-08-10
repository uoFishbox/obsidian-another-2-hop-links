import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { newLinksSectionConfig } from "ui/components/sections/sectionConfigs";
import type { TwoHopIndexedLink } from "types/domain";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import { materializeItemPrefix } from "./materializeItemPrefix";

export interface CreateNewLinksSectionDescriptorParams {
	readonly items: readonly TwoHopIndexedLink[];
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

/** Builds an immutable new-links publication with allocation-free viewport reads. */
export function createNewLinksSectionDescriptor(
	params: CreateNewLinksSectionDescriptorParams,
): TwoHopSectionModel {
	const rows = materializeItemPrefix(
		params.items,
		params.itemLimit,
		params.previousItems,
		(source, index): TwoHopItemModel => {
			const item: ViewItem = { type: "newLink", data: source };
			const virtualKey = newLinksSectionConfig.getKey(source, index);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				item,
				interactionId: params.createItemInteractionToken(interactionKey),
				interactionKey,
				searchKey: virtualKey,
				key: virtualKey,
			};
		},
	);
	return createTwoHopSectionModel({
		kind: "new-links-section",
		id: newLinksSectionConfig.sectionId,
		title: newLinksSectionConfig.title,
		items: rows,
		totalCount: params.items.length,
	});
}
