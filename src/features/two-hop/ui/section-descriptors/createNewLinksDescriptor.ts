import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { newLinksSectionConfig } from "ui/components/sections/sectionConfigs";
import type { TwoHopIndexedLink } from "types/domain";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import { createDescriptor, createLazyVirtualItemAccessors } from "./descriptorIdentity";

export interface CreateNewLinksSectionDescriptorParams {
	readonly items: readonly TwoHopIndexedLink[];
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

export const getNewLinkViewItemKey = (item: ViewItem, index: number): string =>
	newLinksSectionConfig.getKey(item.data as TwoHopIndexedLink, index);

/** Builds an immutable new-links publication with descriptor-local lazy rows. */
export function createNewLinksSectionDescriptor(
	params: CreateNewLinksSectionDescriptorParams,
): TwoHopVirtualSectionDescriptor {
	const items: readonly ViewItem[] = params.items.map(
		(item): ViewItem => ({ type: "newLink", data: item }),
	);
	const accessors = createLazyVirtualItemAccessors({
		getLength: () => items.length,
		createItem: (index) => {
			const item = items[index];
			const virtualKey = getNewLinkViewItemKey(item, index);
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
	});

	return createDescriptor(
		{
			kind: "new-links-section",
			rawSectionId: newLinksSectionConfig.sectionId,
			sectionId: newLinksSectionConfig.sectionId,
			sectionKey: newLinksSectionConfig.sectionId,
			title: newLinksSectionConfig.title,
			className: newLinksSectionConfig.className,
			getKey: getNewLinkViewItemKey,
		},
		items.length,
		accessors.getItems,
		accessors.getItem,
	);
}
