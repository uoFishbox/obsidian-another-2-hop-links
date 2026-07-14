import type { TFile } from "obsidian";
import type {
	DisplayData,
	MergedLinkItem,
} from "application/presenters/displayDataBuilder";
import {
	createStableViewItemReconciler,
	type StableViewItemReconciler,
	type ViewItem,
} from "application/presenters";
import {
	backlinksSectionConfig,
	mergedLinksSectionConfig,
	newLinksSectionConfig,
	outgoingLinksSectionConfig,
} from "ui/components/sections/sectionConfigs";
import {
	createCompactSectionId,
	SHOULD_VALIDATE_SECTION_IDS,
} from "ui/components/common/listPagination";
import { generateBranchKey } from "features/preview/text-processing/textUtils";
import type { TagGroup, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import type { PluginSettings, SortOption } from "types/settings";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	hasSameBacklinkIndexedLink,
	hasSameTwoHopBranchCard,
	hasSameTwoHopIndexedLink,
} from "ui/utils/twohopEquality";
import type { TwoHopVirtualSectionDescriptor } from "./twoHopVirtualListModel";
import type {
	NewLinksSectionItemsDeps,
	PrimaryLinkSection,
	PrimarySectionItemsDeps,
	TagSectionItemsDeps,
} from "./twoHopPageTypes";
import {
	getBacklinkSearchKey,
	getMergedSearchKey,
	getOutgoingSearchKey,
} from "./twoHopSearchAdapter";
import {
	hasSameDescriptorRefs,
	pruneInactiveEntries,
} from "./twoHopSectionDescriptorIdentityCache/descriptorIdentity";
import {
	createTwoHopInteractionTokenAllocator,
	type TwoHopInteractionTokenAllocator,
} from "./twoHopSectionDescriptorIdentityCache/interactionTokenAllocator";
import {
	resolveBranchSectionEntry,
	type BranchEntry,
} from "./twoHopSectionDescriptorIdentityCache/createBranchSectionEntries";
import {
	resolveNewLinkSectionEntry,
	type NewLinksEntry,
} from "./twoHopSectionDescriptorIdentityCache/createNewLinkSectionEntries";
import {
	resolvePrimarySectionEntry,
	type PrimaryEntry,
} from "./twoHopSectionDescriptorIdentityCache/createPrimarySectionEntries";
import {
	resolveTagSectionEntry,
	type TagEntry,
} from "./twoHopSectionDescriptorIdentityCache/createTagSectionEntries";
import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

export interface ResolveTwoHopSectionDescriptorIdentityParams {
	readonly displayData: DisplayData;
	readonly searchQuery: string;
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
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
	readonly onTagClick: (tag: string) => void;
}

/**
 * Page-owned cache preserving section, descriptor, and item identity.
 *
 * Each resolve reconciles the current display/search/settings inputs and
 * evicts inactive section entries. Explicit invalidation clears entry maps,
 * reconcilers, interaction tokens, and the descriptor array. It is not read by
 * the scroll hot path and reports
 * `twoHop.sectionDescriptorIdentityCache.*` counters.
 */
export interface TwoHopSectionDescriptorIdentityCache {
	resolve(
		params: ResolveTwoHopSectionDescriptorIdentityParams,
	): readonly TwoHopVirtualSectionDescriptor[];
	invalidate(): void;
}

interface PrimarySectionFactoryParams {
	readonly displayData: DisplayData;
	readonly useMergedLinks: boolean;
}

const isBranchItem = (item: MergedLinkItem): item is TwoHopLinkBranch =>
	"hop1" in item && "hop2" in item;

const hasSameMergedItem = (current: MergedLinkItem, next: MergedLinkItem): boolean =>
	isBranchItem(current)
		? isBranchItem(next) && hasSameTwoHopBranchCard(current, next)
		: !isBranchItem(next) && hasSameBacklinkIndexedLink(current, next);

interface PrimarySectionReconcilers {
	readonly outgoingItemsReconciler: StableViewItemReconciler<TwoHopLinkBranch>;
	readonly backlinksItemsReconciler: StableViewItemReconciler<TwoHopIndexedLink>;
	readonly mergedItemsReconciler: StableViewItemReconciler<MergedLinkItem>;
}

function createPrimarySections(
	params: PrimarySectionFactoryParams,
	reconcilers: PrimarySectionReconcilers,
): PrimaryLinkSection[] {
	if (params.useMergedLinks) {
		const items = reconcilers.mergedItemsReconciler.reconcile(
			params.displayData.mergedItems,
		);
		return items.length === 0
			? []
			: [
					{
						title: mergedLinksSectionConfig.title,
						sectionId: mergedLinksSectionConfig.sectionId,
						className: mergedLinksSectionConfig.className,
						items,
						getKey: (item, index) =>
							mergedLinksSectionConfig.getKey(
								item.data as MergedLinkItem,
								index,
							),
						getSearchKey: (item) =>
							getMergedSearchKey(item.data as MergedLinkItem),
					},
				];
	}

	const sections: PrimaryLinkSection[] = [];
	const outgoing = reconcilers.outgoingItemsReconciler.reconcile(
		params.displayData.outgoing,
	);
	const backlinks = reconcilers.backlinksItemsReconciler.reconcile(
		params.displayData.backlinks,
	);
	if (outgoing.length > 0) {
		sections.push({
			title: outgoingLinksSectionConfig.title,
			sectionId: outgoingLinksSectionConfig.sectionId,
			className: outgoingLinksSectionConfig.className,
			items: outgoing,
			getKey: (item, index) =>
				outgoingLinksSectionConfig.getKey(item.data as TwoHopLinkBranch, index),
			getSearchKey: (item) => getOutgoingSearchKey(item.data as TwoHopLinkBranch),
		});
	}
	if (backlinks.length > 0) {
		sections.push({
			title: backlinksSectionConfig.title,
			sectionId: backlinksSectionConfig.sectionId,
			className: backlinksSectionConfig.className,
			items: backlinks,
			getKey: (item, index) =>
				backlinksSectionConfig.getKey(item.data as TwoHopIndexedLink, index),
			getSearchKey: (item) =>
				getBacklinkSearchKey(item.data as TwoHopIndexedLink),
		});
	}
	return sections;
}

function appendDescriptor(
	descriptors: TwoHopVirtualSectionDescriptor[],
	seenFinalIds: Map<string, number> | null,
	descriptor: TwoHopVirtualSectionDescriptor,
): void {
	if (descriptor.totalCount <= 0) return;
	const previousIndex = seenFinalIds?.get(descriptor.sectionId);
	if (previousIndex !== undefined) {
		throw new Error(
			`TwoHopSectionDescriptorIdentityCache: duplicate sectionId ${JSON.stringify(
				descriptor.sectionId,
			)} at indexes ${previousIndex} and ${descriptors.length}.`,
		);
	}
	seenFinalIds?.set(descriptor.sectionId, descriptors.length);
	descriptors.push(descriptor);
}

function createReconcilers(): PrimarySectionReconcilers & {
	readonly newLinksItemsReconciler: StableViewItemReconciler<TwoHopIndexedLink>;
} {
	return {
		outgoingItemsReconciler: createStableViewItemReconciler<TwoHopLinkBranch>({
			getKey: (item, index) => outgoingLinksSectionConfig.getKey(item, index),
			toViewItem: (item) => ({ type: "branch", data: item }),
			canReuseSource: hasSameTwoHopBranchCard,
		}),
		backlinksItemsReconciler: createStableViewItemReconciler<TwoHopIndexedLink>({
			getKey: (item, index) => backlinksSectionConfig.getKey(item, index),
			toViewItem: (item) => ({ type: "backlink", data: item }),
			canReuseSource: hasSameBacklinkIndexedLink,
		}),
		mergedItemsReconciler: createStableViewItemReconciler<MergedLinkItem>({
			getKey: (item, index) => mergedLinksSectionConfig.getKey(item, index),
			toViewItem: (item) =>
				isBranchItem(item)
					? { type: "branch", data: item }
					: { type: "backlink", data: item },
			canReuseSource: hasSameMergedItem,
		}),
		newLinksItemsReconciler: createStableViewItemReconciler<TwoHopIndexedLink>({
			getKey: (item, index) => newLinksSectionConfig.getKey(item, index),
			toViewItem: (item) => ({ type: "newLink", data: item }),
			canReuseSource: hasSameTwoHopIndexedLink,
		}),
	};
}

function appendPrimarySections(params: {
	readonly descriptors: TwoHopVirtualSectionDescriptor[];
	readonly seenFinalIds: Map<string, number> | null;
	readonly activePrimaryIds: Set<string>;
	readonly primaryEntries: Map<string, PrimaryEntry>;
	readonly resolveParams: ResolveTwoHopSectionDescriptorIdentityParams;
	readonly reconcilers: PrimarySectionReconcilers;
	readonly tokens: TwoHopInteractionTokenAllocator;
}): void {
	for (const source of createPrimarySections(
		params.resolveParams,
		params.reconcilers,
	)) {
		const rawSectionId = source.sectionId;
		params.activePrimaryIds.add(rawSectionId);
		const itemsDeps: PrimarySectionItemsDeps = {
			items: source.items,
			updateVersion: params.resolveParams.applicationStore.updateVersion,
		};
		const entry = resolvePrimarySectionEntry({
			entry: params.primaryEntries.get(rawSectionId),
			rawSectionId,
			source,
			itemsDeps,
			searchQuery: params.resolveParams.searchQuery,
			createItemInteractionToken: params.tokens.createItemInteractionToken,
		});
		params.primaryEntries.set(rawSectionId, entry);
		appendDescriptor(params.descriptors, params.seenFinalIds, entry.descriptor);
	}
}

function appendBranchSections(params: {
	readonly descriptors: TwoHopVirtualSectionDescriptor[];
	readonly seenFinalIds: Map<string, number> | null;
	readonly activeBranchIds: Set<string>;
	readonly branchEntries: Map<string, BranchEntry>;
	readonly resolveParams: ResolveTwoHopSectionDescriptorIdentityParams;
	readonly tokens: TwoHopInteractionTokenAllocator;
}): void {
	for (const branch of params.resolveParams.displayData.twoHopBranches) {
		const sectionKey = generateBranchKey(branch);
		const rawSectionId = createCompactSectionId("twohop", sectionKey);
		params.activeBranchIds.add(rawSectionId);
		const entry = resolveBranchSectionEntry({
			entry: params.branchEntries.get(rawSectionId),
			branch,
			rawSectionId,
			sectionKey,
			searchQuery: params.resolveParams.searchQuery,
			sourceFile: params.resolveParams.sourceFile,
			resolveFile: params.resolveParams.resolveFile,
			fileToLinktext: params.resolveParams.fileToLinktext,
			currentSort: params.resolveParams.currentSort,
			currentSettings: params.resolveParams.currentSettings,
			applicationStore: params.resolveParams.applicationStore,
			tokens: params.tokens,
		});
		params.branchEntries.set(rawSectionId, entry);
		appendDescriptor(params.descriptors, params.seenFinalIds, entry.descriptor);
	}
}

function appendTagSections(params: {
	readonly descriptors: TwoHopVirtualSectionDescriptor[];
	readonly seenFinalIds: Map<string, number> | null;
	readonly activeTagIds: Set<string>;
	readonly tagEntries: Map<string, TagEntry>;
	readonly resolveParams: ResolveTwoHopSectionDescriptorIdentityParams;
	readonly tokens: TwoHopInteractionTokenAllocator;
}): void {
	if (!params.resolveParams.showTags) return;

	for (const source of params.resolveParams.displayData.tagGroups) {
		const rawSectionId = `tags-${source.tag}`;
		params.activeTagIds.add(rawSectionId);
		const itemsDeps: TagSectionItemsDeps = {
			notes: source.notes,
			sortOption: params.resolveParams.currentSort,
			updateVersion: params.resolveParams.applicationStore.updateVersion,
			getSortedTagGroupItems:
				params.resolveParams.applicationStore.getSortedTagGroupItems,
		};
		const entry = resolveTagSectionEntry({
			entry: params.tagEntries.get(rawSectionId),
			source,
			rawSectionId,
			searchQuery: params.resolveParams.searchQuery,
			applicationStore: params.resolveParams.applicationStore,
			itemsDeps,
			onTagClick: params.resolveParams.onTagClick,
			tokens: params.tokens,
		});
		params.tagEntries.set(rawSectionId, entry);
		appendDescriptor(params.descriptors, params.seenFinalIds, entry.descriptor);
	}
}

function appendNewLinksSection(params: {
	readonly descriptors: TwoHopVirtualSectionDescriptor[];
	readonly seenFinalIds: Map<string, number> | null;
	readonly activeNewLinksIds: Set<string>;
	readonly newLinksEntries: Map<string, NewLinksEntry>;
	readonly resolveParams: ResolveTwoHopSectionDescriptorIdentityParams;
	readonly newLinksItemsReconciler: StableViewItemReconciler<TwoHopIndexedLink>;
	readonly tokens: TwoHopInteractionTokenAllocator;
}): void {
	const newLinks = params.newLinksItemsReconciler.reconcile(
		params.resolveParams.displayData.newLinks,
	);
	if (newLinks.length === 0) return;

	const rawSectionId = newLinksSectionConfig.sectionId;
	params.activeNewLinksIds.add(rawSectionId);
	const itemsDeps: NewLinksSectionItemsDeps = {
		items: newLinks,
		updateVersion: params.resolveParams.applicationStore.updateVersion,
	};
	const entry = resolveNewLinkSectionEntry({
		entry: params.newLinksEntries.get(rawSectionId),
		rawSectionId,
		searchQuery: params.resolveParams.searchQuery,
		itemsDeps,
		createItemInteractionToken: params.tokens.createItemInteractionToken,
	});
	params.newLinksEntries.set(rawSectionId, entry);
	appendDescriptor(params.descriptors, params.seenFinalIds, entry.descriptor);
}

export function createTwoHopSectionDescriptorIdentityCache(): TwoHopSectionDescriptorIdentityCache {
	let reconcilers = createReconcilers();
	const branchEntries = new Map<string, BranchEntry>();
	const tagEntries = new Map<string, TagEntry>();
	const primaryEntries = new Map<string, PrimaryEntry>();
	const newLinksEntries = new Map<string, NewLinksEntry>();
	let tokens = createTwoHopInteractionTokenAllocator();
	let previousDescriptors: readonly TwoHopVirtualSectionDescriptor[] = [];
	let initialized = false;

	return {
		resolve(params) {
			const descriptors: TwoHopVirtualSectionDescriptor[] = [];
			const activeBranchIds = new Set<string>();
			const activeTagIds = new Set<string>();
			const activePrimaryIds = new Set<string>();
			const activeNewLinksIds = new Set<string>();
			const seenFinalIds = SHOULD_VALIDATE_SECTION_IDS
				? new Map<string, number>()
				: null;

			appendPrimarySections({
				descriptors,
				seenFinalIds,
				activePrimaryIds,
				primaryEntries,
				resolveParams: params,
				reconcilers,
				tokens,
			});
			appendBranchSections({
				descriptors,
				seenFinalIds,
				activeBranchIds,
				branchEntries,
				resolveParams: params,
				tokens,
			});
			appendTagSections({
				descriptors,
				seenFinalIds,
				activeTagIds,
				tagEntries,
				resolveParams: params,
				tokens,
			});
			appendNewLinksSection({
				descriptors,
				seenFinalIds,
				activeNewLinksIds,
				newLinksEntries,
				resolveParams: params,
				newLinksItemsReconciler: reconcilers.newLinksItemsReconciler,
				tokens,
			});

			pruneInactiveEntries(branchEntries, activeBranchIds);
			pruneInactiveEntries(tagEntries, activeTagIds);
			pruneInactiveEntries(primaryEntries, activePrimaryIds);
			pruneInactiveEntries(newLinksEntries, activeNewLinksIds);

			if (
				initialized &&
				hasSameDescriptorRefs(previousDescriptors, descriptors)
			) {
				if (process.env.NODE_ENV !== "production") {
					recordCCLDevMeasurement(
						"twoHop.sectionDescriptorIdentityCache.hit",
					);
				}
				return previousDescriptors;
			}
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement("twoHop.sectionDescriptorIdentityCache.miss");
			}
			previousDescriptors = Object.freeze(descriptors);
			initialized = true;
			return previousDescriptors;
		},
		invalidate(): void {
			reconcilers = createReconcilers();
			branchEntries.clear();
			tagEntries.clear();
			primaryEntries.clear();
			newLinksEntries.clear();
			tokens = createTwoHopInteractionTokenAllocator();
			previousDescriptors = [];
			initialized = false;
			if (process.env.NODE_ENV !== "production") {
				recordCCLDevMeasurement(
					"twoHop.sectionDescriptorIdentityCache.invalidate",
				);
			}
		},
	};
}
