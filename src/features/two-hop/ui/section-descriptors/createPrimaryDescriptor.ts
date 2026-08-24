import type {
	DisplayData,
	MergedLinkItem,
} from "features/two-hop/application/displayDataBuilder";
import type { ViewItem } from "application/presenters/ViewItem";
import type { SectionConfig } from "ui/components/sections/types";
import {
	backlinksSectionConfig,
	mergedLinksSectionConfig,
	outgoingLinksSectionConfig,
} from "ui/components/sections/sectionConfigs";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import {
	getBacklinkSearchKey,
	getMergedSearchKey,
	getOutgoingSearchKey,
} from "features/two-hop/ui/twoHopSearchAdapter";
import type {
	TwoHopItemModel,
	TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import { createTwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
import { materializeItemPrefix } from "./materializeItemPrefix";

export type PrimarySectionBuildInput =
	| {
			readonly kind: "outgoing";
			readonly items: DisplayData["outgoing"];
	  }
	| {
			readonly kind: "backlinks";
			readonly items: DisplayData["backlinks"];
	  }
	| {
			readonly kind: "merged";
			readonly items: DisplayData["mergedItems"];
	  };

export interface CreatePrimarySectionDescriptorParams {
	readonly input: PrimarySectionBuildInput;
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly createItemInteractionToken: (semanticKey: string) => string;
}

/**
 * Builds one immutable primary-section publication.
 *
 * Only the published prefix is materialized; viewport reads remain
 * allocation-free and later expansions reuse existing item models.
 */
export function createPrimarySectionDescriptor(
	params: CreatePrimarySectionDescriptorParams,
): TwoHopSectionModel {
	switch (params.input.kind) {
		case "outgoing":
			return createPrimaryDescriptor({
				items: params.input.items,
				itemLimit: params.itemLimit,
				previousItems: params.previousItems,
				config: outgoingLinksSectionConfig,
				toViewItem: (item) => ({ type: "branch", data: item }),
				getSearchKey: getOutgoingSearchKey,
				createItemInteractionToken: params.createItemInteractionToken,
			});
		case "backlinks":
			return createPrimaryDescriptor({
				items: params.input.items,
				itemLimit: params.itemLimit,
				previousItems: params.previousItems,
				config: backlinksSectionConfig,
				toViewItem: (item) => ({ type: "backlink", data: item }),
				getSearchKey: getBacklinkSearchKey,
				createItemInteractionToken: params.createItemInteractionToken,
			});
		case "merged":
			return createPrimaryDescriptor({
				items: params.input.items,
				itemLimit: params.itemLimit,
				previousItems: params.previousItems,
				config: mergedLinksSectionConfig,
				toViewItem: toMergedViewItem,
				getSearchKey: getMergedSearchKey,
				createItemInteractionToken: params.createItemInteractionToken,
			});
	}
}

interface CreatePrimaryDescriptorParams<T> {
	readonly items: readonly T[];
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly config: SectionConfig<T>;
	readonly toViewItem: (item: T) => ViewItem;
	readonly getSearchKey: (item: T) => string;
	readonly createItemInteractionToken: (semanticKey: string) => string;
}

function createPrimaryDescriptor<T>(
	params: CreatePrimaryDescriptorParams<T>,
): TwoHopSectionModel {
	const rows = materializeItemPrefix(
		params.items,
		params.itemLimit,
		params.previousItems,
		(source, index): TwoHopItemModel => {
			const item = params.toViewItem(source);
			const virtualKey = params.config.getKey(source, index);
			const semanticKey = createItemInteractionKey(item, virtualKey);
			return {
				item,
				interactionId: params.createItemInteractionToken(semanticKey),
				searchKey: params.getSearchKey(source),
				key: virtualKey,
			};
		},
	);
	return createTwoHopSectionModel({
		kind: "primary-section",
		id: params.config.sectionId,
		title: params.config.title,
		items: rows,
		totalCount: params.items.length,
	});
}

function toMergedViewItem(item: MergedLinkItem): ViewItem {
	return "hop1" in item
		? { type: "branch", data: item }
		: { type: "backlink", data: item };
}
