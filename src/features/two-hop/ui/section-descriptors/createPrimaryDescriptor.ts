import type {
	DisplayData,
	MergedLinkItem,
} from "features/two-hop/application/displayDataBuilder";
import type { ViewItem } from "application/presenters";
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
	TwoHopVirtualListItem,
	TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createDescriptor,
	createEagerVirtualItemAccessors,
} from "./descriptorIdentity";

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
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

/**
 * Builds one immutable primary-section publication.
 *
 * Final virtual rows are materialized in one eager pass so viewport reads are
 * allocation-free. Unchanged publications are reused by the section cache
 * before this builder is called.
 */
export function createPrimarySectionDescriptor(
	params: CreatePrimarySectionDescriptorParams,
): TwoHopVirtualSectionDescriptor {
	switch (params.input.kind) {
		case "outgoing":
			return createPrimaryDescriptor({
				items: params.input.items,
				config: outgoingLinksSectionConfig,
				toViewItem: (item) => ({ type: "branch", data: item }),
				getSearchKey: getOutgoingSearchKey,
				createItemInteractionToken: params.createItemInteractionToken,
			});
		case "backlinks":
			return createPrimaryDescriptor({
				items: params.input.items,
				config: backlinksSectionConfig,
				toViewItem: (item) => ({ type: "backlink", data: item }),
				getSearchKey: getBacklinkSearchKey,
				createItemInteractionToken: params.createItemInteractionToken,
			});
		case "merged":
			return createPrimaryDescriptor({
				items: params.input.items,
				config: mergedLinksSectionConfig,
				toViewItem: toMergedViewItem,
				getSearchKey: getMergedSearchKey,
				createItemInteractionToken: params.createItemInteractionToken,
			});
	}
}

interface CreatePrimaryDescriptorParams<T> {
	readonly items: readonly T[];
	readonly config: SectionConfig<T>;
	readonly toViewItem: (item: T) => ViewItem;
	readonly getSearchKey: (item: T) => string;
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

function createPrimaryDescriptor<T>(
	params: CreatePrimaryDescriptorParams<T>,
): TwoHopVirtualSectionDescriptor {
	const rows: readonly TwoHopVirtualListItem[] = params.items.map(
		(source, index): TwoHopVirtualListItem => {
			const item = params.toViewItem(source);
			const virtualKey = params.config.getKey(source, index);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				kind: "primary-link",
				item,
				interactionId: params.createItemInteractionToken(interactionKey),
				interactionKey,
				sourceSectionId: params.config.sectionId,
				searchKey: params.getSearchKey(source),
				virtualKey,
			};
		},
	);
	const accessors = createEagerVirtualItemAccessors(rows);

	return createDescriptor(
		{
			kind: "primary-section",
			rawSectionId: params.config.sectionId,
			sectionId: params.config.sectionId,
			sectionKey: params.config.sectionId,
			title: params.config.title,
			className: params.config.className,
		},
		rows.length,
		accessors.getItems,
		accessors.getItem,
	);
}

function toMergedViewItem(item: MergedLinkItem): ViewItem {
	return "hop1" in item
		? { type: "branch", data: item }
		: { type: "backlink", data: item };
}
