import type {
	DisplayData,
	MergedLinkItem,
} from "features/two-hop/application/displayDataBuilder";
import type { ViewItem } from "application/presenters";
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
import type { TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import { createDescriptor, createLazyVirtualItemAccessors } from "./descriptorIdentity";

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
 * Item wrappers are local to the publication and remain lazy. A changed
 * section receives a fresh accessor cache; unchanged sections are reused by
 * the publication cache before this builder is called.
 */
export function createPrimarySectionDescriptor(
	params: CreatePrimarySectionDescriptorParams,
): TwoHopVirtualSectionDescriptor {
	const source = createPrimarySource(params.input);
	const accessors = createLazyVirtualItemAccessors({
		getLength: () => source.items.length,
		createItem: (index) => {
			const item = source.items[index];
			const virtualKey = source.getKey(item, index);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				kind: "primary-link",
				item,
				interactionId: params.createItemInteractionToken(interactionKey),
				interactionKey,
				sourceSectionId: source.sectionId,
				searchKey: source.getSearchKey(item),
				virtualKey,
			};
		},
	});

	return createDescriptor(
		{
			kind: "primary-section",
			rawSectionId: source.sectionId,
			sectionId: source.sectionId,
			sectionKey: source.sectionId,
			title: source.title,
			className: source.className,
			source,
		},
		source.items.length,
		accessors.getItems,
		accessors.getItem,
	);
}

function createPrimarySource(input: PrimarySectionBuildInput): {
	readonly title: string;
	readonly sectionId: string;
	readonly className: string | undefined;
	readonly items: readonly ViewItem[];
	readonly getKey: (item: ViewItem, index: number) => string;
	readonly getSearchKey: (item: ViewItem) => string;
} {
	switch (input.kind) {
		case "outgoing":
			return {
				title: outgoingLinksSectionConfig.title,
				sectionId: outgoingLinksSectionConfig.sectionId,
				className: outgoingLinksSectionConfig.className,
				items: input.items.map(
					(item): ViewItem => ({ type: "branch", data: item }),
				),
				getKey: (item, index) =>
					outgoingLinksSectionConfig.getKey(
						item.data as TwoHopLinkBranch,
						index,
					),
				getSearchKey: (item) =>
					getOutgoingSearchKey(item.data as TwoHopLinkBranch),
			};
		case "backlinks":
			return {
				title: backlinksSectionConfig.title,
				sectionId: backlinksSectionConfig.sectionId,
				className: backlinksSectionConfig.className,
				items: input.items.map(
					(item): ViewItem => ({ type: "backlink", data: item }),
				),
				getKey: (item, index) =>
					backlinksSectionConfig.getKey(
						item.data as TwoHopIndexedLink,
						index,
					),
				getSearchKey: (item) =>
					getBacklinkSearchKey(item.data as TwoHopIndexedLink),
			};
		case "merged":
			return {
				title: mergedLinksSectionConfig.title,
				sectionId: mergedLinksSectionConfig.sectionId,
				className: mergedLinksSectionConfig.className,
				items: input.items.map(toMergedViewItem),
				getKey: (item, index) =>
					mergedLinksSectionConfig.getKey(item.data as MergedLinkItem, index),
				getSearchKey: (item) => getMergedSearchKey(item.data as MergedLinkItem),
			};
	}
}

function toMergedViewItem(item: MergedLinkItem): ViewItem {
	return "hop1" in item
		? { type: "branch", data: item }
		: { type: "backlink", data: item };
}
