import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { newLinksSectionConfig } from "ui/components/sections/sectionConfigs";
import type { TwoHopIndexedLink } from "types/domain";
import type {
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createDescriptor,
	createEagerVirtualItemAccessors,
} from "./descriptorIdentity";

export interface CreateNewLinksSectionDescriptorParams {
	readonly items: readonly TwoHopIndexedLink[];
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

/** Builds an immutable new-links publication with allocation-free viewport reads. */
export function createNewLinksSectionDescriptor(
	params: CreateNewLinksSectionDescriptorParams,
): TwoHopVirtualSectionDescriptor {
	const rows: readonly TwoHopVirtualListItem[] = params.items.map(
		(source, index): TwoHopVirtualListItem => {
			const item: ViewItem = { type: "newLink", data: source };
			const virtualKey = newLinksSectionConfig.getKey(source, index);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				kind: "new-link",
				item,
				interactionId: params.createItemInteractionToken(interactionKey),
				interactionKey,
				searchKey: virtualKey,
				virtualKey,
			};
		},
	);
	const accessors = createEagerVirtualItemAccessors(rows);

	return createDescriptor(
		{
			kind: "new-links-section",
			rawSectionId: newLinksSectionConfig.sectionId,
			sectionId: newLinksSectionConfig.sectionId,
			sectionKey: newLinksSectionConfig.sectionId,
			title: newLinksSectionConfig.title,
			className: newLinksSectionConfig.className,
		},
		rows.length,
		accessors.getItems,
		accessors.getItem,
	);
}
