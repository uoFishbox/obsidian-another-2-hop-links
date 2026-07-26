import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import { createItemInteractionKey } from "ui/interactions/interactionTypes";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import type { SectionHeaderInteractionDescriptor } from "ui/interactions/interactionTypes";
import { buildScopedSectionId } from "ui/components/common/listPagination";
import {
	formatLinkText,
	generateBacklinkKey,
} from "features/preview/text-processing/textUtils";
import type { TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import type { PluginSettings, SortOption } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	createDescriptor,
	createLazySortedVirtualItemAccessors,
	type CachedVirtualItemAccessors,
} from "./descriptorIdentity";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import {
	createHeaderInteractionDescriptor,
	hasSameHeaderInteractionSnapshot,
	hasSameHeaderSnapshot,
	hasSameTwoHopItemsDeps,
} from "features/two-hop/ui/twoHopDataIdentityEquality";
import type {
	TwoHopHeaderInteractionSnapshot,
	TwoHopHeaderSnapshot,
	TwoHopItemsDeps,
} from "features/two-hop/ui/twoHopPageTypes";
import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createTwohopChildSearchKeyFromBaseKeys,
	getTwohopBranchSearchBaseKey,
} from "features/two-hop/ui/twoHopSearchAdapter";

export interface BranchEntry {
	applicationStore: ApplicationStore;
	branch: TwoHopLinkBranch;
	itemsDeps: TwoHopItemsDeps;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: CachedVirtualItemAccessors["getItems"];
	getItem: CachedVirtualItemAccessors["getItem"];
	headerSnapshot: TwoHopHeaderSnapshot;
	headerInteractionSnapshot: TwoHopHeaderInteractionSnapshot;
	headerProps: ClickableHeaderExtraProps;
	headerInteractionDescriptor: SectionHeaderInteractionDescriptor;
	descriptor: TwoHopVirtualSectionDescriptor;
}

export interface ResolveBranchSectionEntryParams {
	readonly entry: BranchEntry | undefined;
	readonly branch: TwoHopLinkBranch;
	readonly rawSectionId: string;
	readonly sectionKey: string;
	readonly searchQuery: string;
	readonly sourceFile: TFile;
	readonly resolveFile: (path: string) => TFile | null;
	readonly fileToLinktext: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string;
	readonly currentSort: SortOption;
	readonly currentSettings: PluginSettings;
	readonly applicationStore: ApplicationStore;
	readonly tokens: TwoHopInteractionTokenAllocator;
}

export function resolveBranchSectionEntry(
	params: ResolveBranchSectionEntryParams,
): BranchEntry {
	const targetFile =
		!params.branch.hop1.isUnresolved && params.branch.hop1.path
			? params.resolveFile(params.branch.hop1.path)
			: null;
	const title = targetFile
		? params.fileToLinktext(targetFile, params.sourceFile.path, true)
		: formatLinkText(params.branch.hop1);
	const headerInteractionSnapshot = {
		link: params.branch.hop1,
		targetFile,
		directory: targetFile?.parent?.path ?? null,
		settings: params.currentSettings,
	} satisfies TwoHopHeaderInteractionSnapshot;
	const headerSnapshot = {
		file: targetFile,
		className: params.branch.hop1.isUnresolved
			? "cosense-card-links__box--missing"
			: "cosense-card-links__box--existing",
		settings: params.currentSettings,
		directory: targetFile?.parent?.path ?? null,
	} satisfies TwoHopHeaderSnapshot;
	const itemsDeps: TwoHopItemsDeps = {
		hop2: params.branch.hop2,
		sortOption: params.currentSort,
		sortContextVersion: params.applicationStore.getSortContextVersion?.() ?? 0,
		getSortedTwoHopItems: params.applicationStore.getSortedTwoHopItems,
	};

	if (!params.entry) {
		return createBranchSectionEntry({
			...params,
			title,
			headerSnapshot,
			headerInteractionSnapshot,
			itemsDeps,
		});
	}

	const itemsChanged = !hasSameTwoHopItemsDeps(params.entry.itemsDeps, itemsDeps);
	const headerChanged = !hasSameHeaderSnapshot(
		params.entry.headerSnapshot,
		headerSnapshot,
	);
	const interactionChanged = !hasSameHeaderInteractionSnapshot(
		params.entry.headerInteractionSnapshot,
		headerInteractionSnapshot,
	);
	params.entry.applicationStore = params.applicationStore;
	params.entry.branch = params.branch;
	params.entry.itemsDeps = itemsDeps;
	if (itemsChanged) params.entry.itemsAccessors.reset();
	if (interactionChanged) {
		params.entry.headerInteractionSnapshot = headerInteractionSnapshot;
		params.entry.headerInteractionDescriptor = createHeaderInteractionDescriptor(
			params.rawSectionId,
			headerInteractionSnapshot,
			params.tokens.createHeaderInteractionIdentity(params.rawSectionId),
		);
	}
	if (headerChanged || interactionChanged) {
		params.entry.headerSnapshot = headerSnapshot;
		params.entry.headerProps = createBranchHeaderProps(
			headerSnapshot,
			params.entry.headerInteractionDescriptor,
		);
	}
	if (
		itemsChanged ||
		headerChanged ||
		interactionChanged ||
		params.entry.descriptor.title !== title ||
		params.entry.descriptor.sectionKey !== params.sectionKey ||
		params.entry.descriptor.paginationKey !==
			buildScopedSectionId(params.rawSectionId, params.searchQuery)
	) {
		params.entry.descriptor = createBranchDescriptor({
			rawSectionId: params.rawSectionId,
			sectionKey: params.sectionKey,
			title,
			branch: params.branch,
			searchQuery: params.searchQuery,
			totalCount: params.branch.hop2.length,
			getItems: params.entry.getItems,
			getItem: params.entry.getItem,
			headerProps: params.entry.headerProps,
		});
	}
	return params.entry;
}

function createBranchSectionEntry(
	params: ResolveBranchSectionEntryParams & {
		readonly title: string;
		readonly headerSnapshot: TwoHopHeaderSnapshot;
		readonly headerInteractionSnapshot: TwoHopHeaderInteractionSnapshot;
		readonly itemsDeps: TwoHopItemsDeps;
	},
): BranchEntry {
	let applicationStore = params.applicationStore;
	let branch = params.branch;
	let itemsDeps = params.itemsDeps;
	const itemsAccessors = createLazySortedVirtualItemAccessors<
		TwoHopIndexedLink,
		ViewItem
	>({
		getLength: () => branch.hop2.length,
		getSortedItems: () =>
			itemsDeps.getSortedTwoHopItems.call(applicationStore, branch.hop2),
		getKey: (item) => generateBacklinkKey(item),
		toViewItem: (item) => ({ type: "backlink", data: item }),
		createItem: (item, virtualKey) => {
			const branchBaseKey = getTwohopBranchSearchBaseKey(branch);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			const interactionId =
				params.tokens.createItemInteractionToken(interactionKey);
			return {
				kind: "two-hop-link",
				item,
				interactionId,
				interactionKey,
				branch,
				searchKey: createTwohopChildSearchKeyFromBaseKeys(
					branchBaseKey,
					virtualKey,
				),
				virtualKey,
			};
		},
	});
	const headerInteractionDescriptor = createHeaderInteractionDescriptor(
		params.rawSectionId,
		params.headerInteractionSnapshot,
		params.tokens.createHeaderInteractionIdentity(params.rawSectionId),
	);
	const headerProps = createBranchHeaderProps(
		params.headerSnapshot,
		headerInteractionDescriptor,
	);

	return {
		get applicationStore() {
			return applicationStore;
		},
		set applicationStore(next) {
			applicationStore = next;
		},
		get branch() {
			return branch;
		},
		set branch(next) {
			branch = next;
		},
		get itemsDeps() {
			return itemsDeps;
		},
		set itemsDeps(next) {
			itemsDeps = next;
		},
		itemsAccessors,
		getItems: itemsAccessors.getItems,
		getItem: itemsAccessors.getItem,
		headerSnapshot: params.headerSnapshot,
		headerInteractionSnapshot: params.headerInteractionSnapshot,
		headerInteractionDescriptor,
		headerProps,
		descriptor: createBranchDescriptor({
			rawSectionId: params.rawSectionId,
			sectionKey: params.sectionKey,
			title: params.title,
			branch,
			searchQuery: params.searchQuery,
			totalCount: branch.hop2.length,
			getItems: itemsAccessors.getItems,
			getItem: itemsAccessors.getItem,
			headerProps,
		}),
	};
}

function createBranchHeaderProps(
	snapshot: TwoHopHeaderSnapshot,
	interactionDescriptor: SectionHeaderInteractionDescriptor,
): ClickableHeaderExtraProps {
	return {
		className: snapshot.className,
		settings: snapshot.settings,
		directory: snapshot.directory,
		draggable: true,
		interactionId: interactionDescriptor.interactionId,
		interactionKind: "sectionHeader",
		interactionDescriptor,
	};
}

function createBranchDescriptor(params: {
	readonly rawSectionId: string;
	readonly sectionKey: string;
	readonly title: string;
	readonly branch: TwoHopLinkBranch;
	readonly searchQuery: string;
	readonly totalCount: number;
	readonly getItems: CachedVirtualItemAccessors["getItems"];
	readonly getItem: CachedVirtualItemAccessors["getItem"];
	readonly headerProps: ClickableHeaderExtraProps;
}): TwoHopVirtualSectionDescriptor {
	return createDescriptor(
		{
			kind: "two-hop-branch",
			rawSectionId: params.rawSectionId,
			sectionId: params.rawSectionId,
			sectionKey: params.sectionKey,
			title: params.title,
			branch: params.branch,
			headerProps: params.headerProps,
		},
		params.searchQuery,
		params.totalCount,
		params.getItems,
		params.getItem,
		params.headerProps,
	);
}
