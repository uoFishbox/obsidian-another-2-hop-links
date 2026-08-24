import type { ViewItem } from "application/presenters/ViewItem";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { generateLinkKey } from "features/card-preview/text-processing/textUtils";
import type { TagGroup } from "types/domain";
import {
	createTaggedNoteSectionItemKey,
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import { getTagNoteSearchKeyFromBaseKey } from "features/two-hop/ui/twoHopSearchAdapter";
import type { TaggedNote } from "types/domain";
import { materializeItemPrefix } from "./materializeItemPrefix";

export interface TagSectionBuildInput {
	readonly source: TagGroup;
	readonly rawSectionId: string;
	readonly sortedItems: readonly TaggedNote[];
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly onTagClick: (tag: string) => void;
}

/** Builds one immutable tag publication from a sorted, bounded prefix. */
export function createTagSectionDescriptor(
	input: TagSectionBuildInput,
	tokens: TwoHopInteractionTokenAllocator,
): TwoHopSectionModel {
	const headerInteractionId = tokens.createHeaderInteractionToken(input.rawSectionId);
	const headerProps: ClickableHeaderExtraProps = {
		className: "cosense-card-links__box--tag",
		interactionId: headerInteractionId,
		onClick: () => input.onTagClick(input.source.tag),
	};
	const rows = materializeItemPrefix(
		input.sortedItems,
		input.itemLimit,
		input.previousItems,
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
			const semanticKey = createItemInteractionKey(item, virtualKey);
			return {
				item,
				interactionId: tokens.createItemInteractionToken(semanticKey),
				searchKey: getTagNoteSearchKeyFromBaseKey(input.source.tag, baseKey),
				key: virtualKey,
			};
		},
	);
	return createTwoHopSectionModel({
		kind: "tag-section",
		id: input.rawSectionId,
		title: `#${input.source.tag}`,
		headerProps,
		items: rows,
		totalCount: input.sortedItems.length,
	});
}
