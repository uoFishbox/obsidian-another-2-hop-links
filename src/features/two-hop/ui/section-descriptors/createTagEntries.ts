import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import { buildScopedSectionId } from "ui/components/common/listPagination";
import { generateLinkKey } from "features/preview/text-processing/textUtils";
import type { TagGroup, TaggedNote } from "types/domain";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	createDescriptor,
	createSparseStableVirtualItemAccessors,
	type CachedVirtualItemAccessors,
} from "./descriptorIdentity";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import { hasSameTagSectionItemsDeps } from "features/two-hop/ui/twoHopDataIdentityEquality";
import {
	createTaggedNoteSectionItemKey,
	type TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import type { TagSectionItemsDeps } from "features/two-hop/ui/twoHopPageTypes";
import { getTagNoteSearchKeyFromBaseKey } from "features/two-hop/ui/twoHopSearchAdapter";

export interface TagEntry {
	applicationStore: ApplicationStore;
	source: TagGroup;
	itemsDeps: TagSectionItemsDeps;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: CachedVirtualItemAccessors["getItems"];
	getItem: CachedVirtualItemAccessors["getItem"];
	tag: string;
	onTagClick: (tag: string) => void;
	headerProps: ClickableHeaderExtraProps;
	descriptor: TwoHopVirtualSectionDescriptor;
}

export interface ResolveTagSectionEntryParams {
	readonly entry: TagEntry | undefined;
	readonly source: TagGroup;
	readonly rawSectionId: string;
	readonly searchQuery: string;
	readonly applicationStore: ApplicationStore;
	readonly itemsDeps: TagSectionItemsDeps;
	readonly onTagClick: (tag: string) => void;
	readonly tokens: TwoHopInteractionTokenAllocator;
}

export function resolveTagSectionEntry(params: ResolveTagSectionEntryParams): TagEntry {
	if (!params.entry) return createTagSectionEntry(params);

	const itemsChanged = !hasSameTagSectionItemsDeps(
		params.entry.itemsDeps,
		params.itemsDeps,
	);
	const callbackChanged = params.entry.onTagClick !== params.onTagClick;
	params.entry.applicationStore = params.applicationStore;
	params.entry.source = params.source;
	params.entry.itemsDeps = params.itemsDeps;
	params.entry.tag = params.source.tag;
	params.entry.onTagClick = params.onTagClick;
	if (itemsChanged) params.entry.itemsAccessors.reset();
	if (
		itemsChanged ||
		callbackChanged ||
		params.entry.descriptor.paginationKey !==
			buildScopedSectionId(params.rawSectionId, params.searchQuery)
	) {
		params.entry.descriptor = createTagDescriptor({
			rawSectionId: params.rawSectionId,
			source: params.source,
			searchQuery: params.searchQuery,
			getItems: params.entry.getItems,
			getItem: params.entry.getItem,
			headerProps: params.entry.headerProps,
		});
	}
	return params.entry;
}

function createTagSectionEntry(params: ResolveTagSectionEntryParams): TagEntry {
	let applicationStore = params.applicationStore;
	let source = params.source;
	let itemsDeps = params.itemsDeps;
	let tag = params.source.tag;
	let onTagClick = params.onTagClick;
	const headerProps: ClickableHeaderExtraProps = {
		className: "cosense-card-links__box--tag",
		interactionId: params.tokens.createHeaderInteractionIdentity(
			params.rawSectionId,
		).interactionId,
		interactionKind: "sectionHeader",
		onClick: () => onTagClick(tag),
	};
	const itemsAccessors = createSparseStableVirtualItemAccessors<TaggedNote, ViewItem>(
		{
			getLength: () => source.notes.length,
			getSortedItems: () =>
				itemsDeps.getSortedTagGroupItems.call(applicationStore, source.notes),
			getKey: (item) =>
				generateLinkKey(item.file.path, item.file.basename, "tag-note"),
			toViewItem: (item) => ({ type: "taggedNote", data: item }),
			createItem: (item, baseKey, index) => {
				const virtualKey = createTaggedNoteSectionItemKey(item, tag, index);
				const interactionKey = createItemInteractionKey(item, virtualKey);
				const interactionId =
					params.tokens.createItemInteractionToken(interactionKey);
				return {
					kind: "tag-link",
					item,
					interactionId,
					interactionKey,
					tag,
					searchKey: getTagNoteSearchKeyFromBaseKey(tag, baseKey),
					virtualKey,
				};
			},
		},
	);

	return {
		get applicationStore() {
			return applicationStore;
		},
		set applicationStore(next) {
			applicationStore = next;
		},
		get source() {
			return source;
		},
		set source(next) {
			source = next;
		},
		get itemsDeps() {
			return itemsDeps;
		},
		set itemsDeps(next) {
			itemsDeps = next;
		},
		get tag() {
			return tag;
		},
		set tag(next) {
			tag = next;
		},
		get onTagClick() {
			return onTagClick;
		},
		set onTagClick(next) {
			onTagClick = next;
		},
		itemsAccessors,
		getItems: itemsAccessors.getItems,
		getItem: itemsAccessors.getItem,
		headerProps,
		descriptor: createTagDescriptor({
			rawSectionId: params.rawSectionId,
			source: params.source,
			searchQuery: params.searchQuery,
			getItems: itemsAccessors.getItems,
			getItem: itemsAccessors.getItem,
			headerProps,
		}),
	};
}

function createTagDescriptor(params: {
	readonly rawSectionId: string;
	readonly source: TagGroup;
	readonly searchQuery: string;
	readonly getItems: CachedVirtualItemAccessors["getItems"];
	readonly getItem: CachedVirtualItemAccessors["getItem"];
	readonly headerProps: ClickableHeaderExtraProps;
}): TwoHopVirtualSectionDescriptor {
	return createDescriptor(
		{
			kind: "tag-section",
			rawSectionId: params.rawSectionId,
			sectionId: params.rawSectionId,
			sectionKey: `tag-${params.source.tag}`,
			title: `#${params.source.tag}`,
			tag: params.source.tag,
			headerProps: params.headerProps,
			className: "twohop-links-tags",
		},
		params.searchQuery,
		params.source.notes.length,
		params.getItems,
		params.getItem,
		params.headerProps,
	);
}
