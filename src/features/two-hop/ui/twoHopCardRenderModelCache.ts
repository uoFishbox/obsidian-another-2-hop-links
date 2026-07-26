import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
import type { LinkUtilitiesContext } from "types/linkContext";
import type { PluginSettings } from "features/settings/model";
import {
	createCardRenderModel,
	type CardRenderModel,
} from "ui/components/items/cardRenderModel";
import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
import {
	resolveTwoHopPageItemSearchScope,
	type TwoHopVirtualListItem,
} from "features/two-hop/ui/twoHopVirtualListModel";

export interface TwoHopCardModelRevision {
	readonly settings: PluginSettings;
	readonly searchQuery: string;
	readonly searchScope: "title-only" | "title-and-content";
	readonly matchedItemByKey: Map<string, SearchWorkerMatchedItem> | null;
	readonly linkContext: LinkUtilitiesContext;
	readonly getPreviewRenderVersion: (path: string) => string;
	readonly applicationUpdateVersion: number;
}

export interface TwoHopCardRenderModelCache {
	resolve(
		row: TwoHopVirtualListItem,
		presentation: TwoHopCardPresentationState,
		revision: TwoHopCardModelRevision,
	): CardRenderModel;
	invalidate(): void;
}

interface CachedCardModel {
	readonly settings: PluginSettings;
	readonly searchQuery: string;
	readonly searchScope: TwoHopCardModelRevision["searchScope"];
	readonly matchedItem: SearchWorkerMatchedItem | undefined;
	readonly linkContext: LinkUtilitiesContext;
	readonly applicationUpdateVersion: number;
	readonly previewVersion: string;
	readonly presentation: TwoHopCardPresentationState;
	readonly model: CardRenderModel;
}

/** Reuses compiled card models across layout-only TwoHop plan recompiles. */
export function createTwoHopCardRenderModelCache(): TwoHopCardRenderModelCache {
	let entries = new WeakMap<TwoHopVirtualListItem, CachedCardModel>();

	return {
		resolve(row, presentation, revision) {
			const cached = entries.get(row);
			const matchedItem = revision.matchedItemByKey?.get(row.searchKey);
			const previewVersion = cached?.model.targetFile
				? revision.getPreviewRenderVersion(cached.model.targetFile.path)
				: "0:0";
			if (
				cached?.settings === revision.settings &&
				cached.searchQuery === revision.searchQuery &&
				cached.searchScope === revision.searchScope &&
				cached.matchedItem === matchedItem &&
				cached.linkContext === revision.linkContext &&
				cached.applicationUpdateVersion === revision.applicationUpdateVersion &&
				cached.previewVersion === previewVersion &&
				isSamePresentation(cached.presentation, presentation)
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement("twoHop.cardRenderModelCache.hit");
				}
				return cached.model;
			}
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.cardRenderModelCache.miss");
			}

			let resolvedPreviewVersion = "0:0";
			const model = createCardRenderModel({
				item: row.item,
				settings: revision.settings,
				context: revision.linkContext,
				getPreviewRenderVersion: (path) => {
					resolvedPreviewVersion = revision.getPreviewRenderVersion(path);
					return resolvedPreviewVersion;
				},
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
			entries.set(row, {
				settings: revision.settings,
				searchQuery: revision.searchQuery,
				searchScope: revision.searchScope,
				matchedItem,
				linkContext: revision.linkContext,
				applicationUpdateVersion: revision.applicationUpdateVersion,
				previewVersion: resolvedPreviewVersion,
				presentation,
				model,
			});
			return model;
		},
		invalidate(): void {
			entries = new WeakMap<TwoHopVirtualListItem, CachedCardModel>();
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.cardRenderModelCache.invalidate");
			}
		},
	};
}

function isSamePresentation(
	current: TwoHopCardPresentationState,
	next: TwoHopCardPresentationState,
): boolean {
	return (
		current.sectionVariant === next.sectionVariant &&
		current.resolution === next.resolution &&
		current.attachment === next.attachment &&
		current.extension === next.extension
	);
}
