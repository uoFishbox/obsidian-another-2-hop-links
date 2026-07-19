import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { buildScopedSectionId } from "ui/components/common/listPagination";
import {
	createDescriptor,
	createSparseVirtualItemAccessors,
	type CachedVirtualItemAccessors,
} from "./descriptorIdentity";
import { hasSamePrimaryItemsDeps } from "features/two-hop/ui/twoHopDataIdentityEquality";
import type {
	PrimaryLinkSection,
	PrimarySectionItemsDeps,
} from "features/two-hop/ui/twoHopPageTypes";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";

export interface PrimaryEntry {
	source: PrimaryLinkSection;
	itemsDeps: PrimarySectionItemsDeps;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: CachedVirtualItemAccessors["getItems"];
	getItem: CachedVirtualItemAccessors["getItem"];
	descriptor: TwoHopVirtualSectionDescriptor;
}

export interface ResolvePrimarySectionEntryParams {
	readonly entry: PrimaryEntry | undefined;
	readonly rawSectionId: string;
	readonly source: PrimaryLinkSection;
	readonly itemsDeps: PrimarySectionItemsDeps;
	readonly searchQuery: string;
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

export function resolvePrimarySectionEntry(
	params: ResolvePrimarySectionEntryParams,
): PrimaryEntry {
	if (!params.entry) return createPrimarySectionEntry(params);

	const itemsChanged = !hasSamePrimaryItemsDeps(
		params.entry.itemsDeps,
		params.itemsDeps,
	);
	const descriptorChanged =
		itemsChanged ||
		params.entry.source.title !== params.source.title ||
		params.entry.source.className !== params.source.className ||
		params.entry.descriptor.paginationKey !==
			buildScopedSectionId(params.rawSectionId, params.searchQuery);
	params.entry.source = params.source;
	params.entry.itemsDeps = params.itemsDeps;
	if (itemsChanged) params.entry.itemsAccessors.reset();
	if (descriptorChanged) {
		params.entry.descriptor = createPrimaryDescriptor({
			rawSectionId: params.rawSectionId,
			source: params.source,
			searchQuery: params.searchQuery,
			getItems: params.entry.getItems,
			getItem: params.entry.getItem,
		});
	}
	return params.entry;
}

function createPrimarySectionEntry(
	params: ResolvePrimarySectionEntryParams,
): PrimaryEntry {
	let source = params.source;
	const itemsAccessors = createSparseVirtualItemAccessors({
		getLength: () => source.items.length,
		createItem: (index) => {
			const item = source.items[index];
			if (!item) return undefined;
			const virtualKey = source.getKey(item, index);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			const interactionId = params.createItemInteractionToken(interactionKey);
			return {
				kind: "primary-link",
				item,
				interactionId,
				interactionKey,
				sourceSectionId: source.sectionId,
				searchKey: source.getSearchKey(item),
				virtualKey,
			};
		},
	});
	const entry: PrimaryEntry = {
		get source() {
			return source;
		},
		set source(next) {
			source = next;
		},
		itemsDeps: params.itemsDeps,
		itemsAccessors,
		getItems: itemsAccessors.getItems,
		getItem: itemsAccessors.getItem,
		descriptor: createPrimaryDescriptor({
			rawSectionId: params.rawSectionId,
			source,
			searchQuery: params.searchQuery,
			getItems: itemsAccessors.getItems,
			getItem: itemsAccessors.getItem,
		}),
	};
	return entry;
}

function createPrimaryDescriptor(params: {
	readonly rawSectionId: string;
	readonly source: PrimaryLinkSection;
	readonly searchQuery: string;
	readonly getItems: CachedVirtualItemAccessors["getItems"];
	readonly getItem: CachedVirtualItemAccessors["getItem"];
}): TwoHopVirtualSectionDescriptor {
	return createDescriptor(
		{
			kind: "primary-section",
			rawSectionId: params.rawSectionId,
			sectionId: params.rawSectionId,
			sectionKey: params.rawSectionId,
			title: params.source.title,
			className: params.source.className,
			source: params.source,
		},
		params.searchQuery,
		params.source.items.length,
		params.getItems,
		params.getItem,
	);
}
