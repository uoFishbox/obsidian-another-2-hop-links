import type { LinkUtilitiesContext } from "ui/context/linkContext";
import type { PluginSettings } from "features/settings/model";
import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
import {
	createItemInteractionDescriptor,
	createItemInteractionKey,
} from "ui/interactions/interactionTypes";
import type { TwoHopVirtualListItem } from "features/two-hop/ui/twoHopVirtualListModel";

export interface TwoHopInteractionDescriptorRevision {
	settings: PluginSettings;
	searchQuery: string;
	linkContext: LinkUtilitiesContext | undefined;
}

export function createTwoHopInteractionDescriptorRevision(params: {
	settings: PluginSettings;
	searchQuery: string;
	linkContext: LinkUtilitiesContext | undefined;
}): TwoHopInteractionDescriptorRevision {
	return {
		settings: params.settings,
		searchQuery: params.searchQuery,
		linkContext: params.linkContext,
	};
}

export function resolveTwoHopItemInteractionDescriptor(
	row: TwoHopVirtualListItem,
	revision: TwoHopInteractionDescriptorRevision,
): ItemInteractionDescriptor | null {
	if (!revision.linkContext) return null;

	return createItemInteractionDescriptor(
		row.item,
		revision.settings,
		revision.searchQuery,
		revision.linkContext,
		{
			interactionId: row.interactionId,
			interactionKey: row.interactionKey ?? createItemInteractionKey(row.item),
		},
	);
}
