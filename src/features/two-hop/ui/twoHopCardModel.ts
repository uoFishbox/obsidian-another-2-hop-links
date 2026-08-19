import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
import type { LinkUtilitiesContext } from "types/linkContext";
import type { PluginSettings } from "features/settings/model";
import {
	createCardRenderModel,
	type CardRenderModel,
} from "ui/components/items/cardRenderModel";
import type { TwoHopItemModel } from "features/two-hop/ui/twoHopSectionModel";

export interface TwoHopCardModelRevision {
	readonly settings: PluginSettings;
	readonly searchQuery: string;
	readonly searchScope: "title-only" | "title-and-content";
	readonly matchesByKey: Map<string, SearchWorkerMatchedItem> | null;
	readonly linkContext: LinkUtilitiesContext;
	readonly getPreviewRenderVersion: (path: string) => string;
	readonly applicationUpdateVersion: number;
}

/** Builds a card model. Reuse is owned by the bounded-range hydrator. */
export function buildTwoHopCardModel(
	row: TwoHopItemModel,
	revision: TwoHopCardModelRevision,
): CardRenderModel {
	const matchedItem = revision.matchesByKey?.get(row.searchKey);
	return createCardRenderModel({
		item: row.item,
		settings: revision.settings,
		context: revision.linkContext,
		getPreviewRenderVersion: revision.getPreviewRenderVersion,
		searchQuery: revision.searchQuery,
		searchScope:
			revision.searchScope === "title-and-content" &&
			(matchedItem?.contentMatched ?? true)
				? "title-and-content"
				: "title-only",
		contentPreview: matchedItem?.contentPreview,
		interactionId: row.interactionId,
	});
}
