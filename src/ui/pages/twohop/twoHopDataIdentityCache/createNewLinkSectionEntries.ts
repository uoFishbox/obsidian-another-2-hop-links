import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import { buildScopedSectionId } from "ui/components/common/listPagination";
import { newLinksSectionConfig } from "ui/components/sections/sectionConfigs";
import type { TwoHopIndexedLink } from "types/domain";
import {
	createDescriptor,
	createSparseVirtualItemAccessors,
	type CachedVirtualItemAccessors,
} from "./descriptorIdentity";
import { hasSameNewLinksItemsDeps } from "../twoHopDataIdentityEquality";
import type { NewLinksSectionItemsDeps } from "../twohopPageTypes";
import type { TwoHopSectionDescriptor } from "../twohopPageVirtualModel";

export interface NewLinksEntry {
	itemsDeps: NewLinksSectionItemsDeps;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: CachedVirtualItemAccessors["getItems"];
	getItem: CachedVirtualItemAccessors["getItem"];
	descriptor: TwoHopSectionDescriptor;
}

export interface ResolveNewLinkSectionEntryParams {
	readonly entry: NewLinksEntry | undefined;
	readonly rawSectionId: string;
	readonly searchQuery: string;
	readonly itemsDeps: NewLinksSectionItemsDeps;
	readonly createItemInteractionToken: (interactionKey: string) => string;
}

export const getNewLinkViewItemKey = (item: ViewItem, index: number): string =>
	newLinksSectionConfig.getKey(item.data as TwoHopIndexedLink, index);

export function resolveNewLinkSectionEntry(
	params: ResolveNewLinkSectionEntryParams,
): NewLinksEntry {
	if (!params.entry) return createNewLinkSectionEntry(params);

	const itemsChanged = !hasSameNewLinksItemsDeps(
		params.entry.itemsDeps,
		params.itemsDeps,
	);
	params.entry.itemsDeps = params.itemsDeps;
	if (itemsChanged) params.entry.itemsAccessors.reset();
	if (
		itemsChanged ||
		params.entry.descriptor.paginationKey !==
			buildScopedSectionId(params.rawSectionId, params.searchQuery)
	) {
		params.entry.descriptor = createNewLinkDescriptor({
			rawSectionId: params.rawSectionId,
			searchQuery: params.searchQuery,
			totalCount: params.itemsDeps.items.length,
			getItems: params.entry.getItems,
			getItem: params.entry.getItem,
		});
	}
	return params.entry;
}

function createNewLinkSectionEntry(
	params: ResolveNewLinkSectionEntryParams,
): NewLinksEntry {
	let itemsDeps = params.itemsDeps;
	const itemsAccessors = createSparseVirtualItemAccessors({
		getLength: () => itemsDeps.items.length,
		createItem: (index) => {
			const item = itemsDeps.items[index];
			if (!item) return undefined;
			const key = getNewLinkViewItemKey(item, index);
			const interactionKey = createItemInteractionKey(item, key);
			const interactionId = params.createItemInteractionToken(interactionKey);
			return {
				kind: "new-link",
				item,
				interactionId,
				interactionKey,
				searchKey: key,
				virtualKey: key,
			};
		},
	});
	const entry: NewLinksEntry = {
		get itemsDeps() {
			return itemsDeps;
		},
		set itemsDeps(next) {
			itemsDeps = next;
		},
		itemsAccessors,
		getItems: itemsAccessors.getItems,
		getItem: itemsAccessors.getItem,
		descriptor: createNewLinkDescriptor({
			rawSectionId: params.rawSectionId,
			searchQuery: params.searchQuery,
			totalCount: itemsDeps.items.length,
			getItems: itemsAccessors.getItems,
			getItem: itemsAccessors.getItem,
		}),
	};
	return entry;
}

function createNewLinkDescriptor(params: {
	readonly rawSectionId: string;
	readonly searchQuery: string;
	readonly totalCount: number;
	readonly getItems: CachedVirtualItemAccessors["getItems"];
	readonly getItem: CachedVirtualItemAccessors["getItem"];
}): TwoHopSectionDescriptor {
	return createDescriptor(
		{
			kind: "new-links-section",
			rawSectionId: params.rawSectionId,
			sectionId: params.rawSectionId,
			sectionKey: params.rawSectionId,
			title: newLinksSectionConfig.title,
			className: newLinksSectionConfig.className,
			getKey: getNewLinkViewItemKey,
		},
		params.searchQuery,
		params.totalCount,
		params.getItems,
		params.getItem,
	);
}
