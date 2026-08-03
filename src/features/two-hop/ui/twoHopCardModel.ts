import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
import type { LinkUtilitiesContext } from "types/linkContext";
import type { PluginSettings } from "features/settings/model";
import {
	createCardRenderModel,
	type CardRenderModel,
} from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import {
	resolveTwoHopPageItemSearchScope,
	type TwoHopItemModel,
} from "features/two-hop/ui/twoHopSectionModel";

export interface TwoHopCardModelRevision {
	readonly settings: PluginSettings;
	readonly searchQuery: string;
	readonly searchScope: "title-only" | "title-and-content";
	readonly matchedItemByKey: Map<string, SearchWorkerMatchedItem> | null;
	readonly linkContext: LinkUtilitiesContext;
	readonly getPreviewRenderVersion: (path: string) => string;
	readonly applicationUpdateVersion: number;
}

/** Builds a card model. Reuse is owned by the progressive hydrator. */
export function buildTwoHopCardModel(
	row: TwoHopItemModel,
	presentation: TwoHopCardPresentationState,
	revision: TwoHopCardModelRevision,
): CardRenderModel {
	const matchedItem = revision.matchedItemByKey?.get(row.searchKey);
	return createCardRenderModel({
		item: row.item,
		settings: revision.settings,
		context: revision.linkContext,
		getPreviewRenderVersion: revision.getPreviewRenderVersion,
		searchQuery: revision.searchQuery,
		searchScope: resolveTwoHopPageItemSearchScope(
			row,
			revision.searchScope,
			matchedItem?.contentMatched,
		),
		contentPreview: matchedItem?.contentPreview,
		interactionId: row.interactionId,
		interactionKey: row.interactionKey,
		presentation,
	});
}
