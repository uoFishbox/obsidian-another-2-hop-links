import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { generateLinkKey } from "features/preview/text-processing/textUtils";
import type { TagGroup, TaggedNote } from "types/domain";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	createTaggedNoteSectionItemKey,
	type TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createDescriptor,
	createLazySortedVirtualItemAccessors,
} from "./descriptorIdentity";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import { getTagNoteSearchKeyFromBaseKey } from "features/two-hop/ui/twoHopSearchAdapter";

export interface TagSectionBuildInput {
	readonly source: TagGroup;
	readonly rawSectionId: string;
	readonly applicationStore: ApplicationStore;
	readonly onTagClick: (tag: string) => void;
}

/** Builds one immutable tag publication with local lazy sorting and rows. */
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
	const accessors = createLazySortedVirtualItemAccessors<TaggedNote, ViewItem>({
		getLength: () => input.source.notes.length,
		getSortedItems: () =>
			input.applicationStore.getSortedTagGroupItems(input.source.notes),
		getKey: (item) =>
			generateLinkKey(item.file.path, item.file.basename, "tag-note"),
		toViewItem: (item) => ({ type: "taggedNote", data: item }),
		createItem: (item, baseKey, index) => {
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
	});

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
		input.source.notes.length,
		accessors.getItems,
		accessors.getItem,
		headerProps,
	);
}
