import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { generateLinkKey } from "features/preview/text-processing/textUtils";
import type { TagGroup } from "types/domain";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	createTaggedNoteSectionItemKey,
	type TwoHopVirtualListItem,
	type TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createDescriptor,
	createEagerVirtualItemAccessors,
} from "./descriptorIdentity";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import { getTagNoteSearchKeyFromBaseKey } from "features/two-hop/ui/twoHopSearchAdapter";

export interface TagSectionBuildInput {
	readonly source: TagGroup;
	readonly rawSectionId: string;
	readonly applicationStore: ApplicationStore;
	readonly onTagClick: (tag: string) => void;
}

/** Builds one immutable tag publication with eager sorting and rows. */
export function createTagSectionDescriptor(
	input: TagSectionBuildInput,
	tokens: TwoHopInteractionTokenAllocator,
): TwoHopVirtualSectionDescriptor {
	const headerInteraction = tokens.createHeaderInteractionIdentity(
		input.rawSectionId,
	);
	const headerProps: ClickableHeaderExtraProps = {
		className: "cosense-card-links__box--tag",
		interactionId: headerInteraction.interactionId,
		interactionKind: "sectionHeader",
		onClick: () => input.onTagClick(input.source.tag),
	};
	const sortedItems = input.applicationStore.getSortedTagGroupItems(
		input.source.notes,
	);
	const rows: readonly TwoHopVirtualListItem[] = sortedItems.map(
		(source, index): TwoHopVirtualListItem => {
			const item: ViewItem = { type: "taggedNote", data: source };
			const baseKey = generateLinkKey(
				source.file.path,
				source.file.basename,
				"tag-note",
			);
			const virtualKey = createTaggedNoteSectionItemKey(
				item,
				input.source.tag,
				index,
			);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				kind: "tag-link",
				item,
				interactionId: tokens.createItemInteractionToken(interactionKey),
				interactionKey,
				tag: input.source.tag,
				searchKey: getTagNoteSearchKeyFromBaseKey(input.source.tag, baseKey),
				virtualKey,
			};
		},
	);
	const accessors = createEagerVirtualItemAccessors(rows);

	return createDescriptor(
		{
			kind: "tag-section",
			rawSectionId: input.rawSectionId,
			sectionId: input.rawSectionId,
			sectionKey: `tag-${input.source.tag}`,
			title: `#${input.source.tag}`,
			tag: input.source.tag,
			headerProps,
			className: "twohop-links-tags",
		},
		rows.length,
		accessors.getItems,
		accessors.getItem,
		headerProps,
	);
}
