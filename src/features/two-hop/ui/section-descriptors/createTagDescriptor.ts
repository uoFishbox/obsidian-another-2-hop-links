import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { generateLinkKey } from "features/card-preview/text-processing/textUtils";
import type { TagGroup } from "types/domain";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	createTaggedNoteSectionItemKey,
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
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
): TwoHopSectionModel {
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
	const rows: readonly TwoHopItemModel[] = sortedItems.map(
		(source, index): TwoHopItemModel => {
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
				key: virtualKey,
			};
		},
	);
	return createTwoHopSectionModel({
		kind: "tag-section",
		id: input.rawSectionId,
		key: `tag-${input.source.tag}`,
		title: `#${input.source.tag}`,
		tag: input.source.tag,
		headerProps,
		className: "twohop-links-tags",
		items: rows,
	});
}
