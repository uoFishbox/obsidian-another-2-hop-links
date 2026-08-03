import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { newLinksSectionConfig } from "ui/components/sections/sectionConfigs";
import type { TwoHopIndexedLink } from "types/domain";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";

export interface CreateNewLinksSectionDescriptorParams {
	readonly items: readonly TwoHopIndexedLink[];
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

/** Builds an immutable new-links publication with allocation-free viewport reads. */
export function createNewLinksSectionDescriptor(
	params: CreateNewLinksSectionDescriptorParams,
): TwoHopSectionModel {
	const rows: readonly TwoHopItemModel[] = params.items.map(
		(source, index): TwoHopItemModel => {
			const item: ViewItem = { type: "newLink", data: source };
			const virtualKey = newLinksSectionConfig.getKey(source, index);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				kind: "new-link",
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
		key: newLinksSectionConfig.sectionId,
		title: newLinksSectionConfig.title,
		className: newLinksSectionConfig.className,
		items: rows,
	});
}
