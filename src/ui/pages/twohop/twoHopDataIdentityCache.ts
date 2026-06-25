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
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import {
	buildScopedSectionId,
	createCompactSectionId,
	SHOULD_VALIDATE_SECTION_IDS,
} from "ui/components/common/listPagination";
import {
	formatLinkText,
	generateBacklinkKey,
	generateBranchKey,
	generateLinkKey,
} from "features/preview/text-processing/textUtils";
import {
	createItemInteractionKey,
	createSectionHeaderInteractionKey,
	type SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import { createInteractionTokenAllocator } from "ui/interactions/interactionRegistry";
import type {
	TagGroup,
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
} from "types/domain";
import type { PluginSettings, SortOption } from "types/settings";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	hasSameBacklinkIndexedLink,
	hasSameTaggedNote,
	hasSameTwoHopBranchCard,
	hasSameTwoHopIndexedLink,
} from "ui/utils/twohopEquality";
import {
	createTaggedNoteSectionItemKey,
	type TwoHopPageVirtualItem,
	type TwoHopPageVirtualSection,
	type TwoHopSectionDescriptor,
} from "./twohopPageVirtualModel";
import {
	createHeaderInteractionDescriptor,
	hasSameHeaderInteractionSnapshot,
	hasSameHeaderSnapshot,
	hasSameNewLinksItemsDeps,
	hasSamePrimaryItemsDeps,
	hasSameTagSectionItemsDeps,
	hasSameTwoHopItemsDeps,
} from "./twoHopDataIdentityEquality";
import type {
	NewLinksSectionItemsDeps,
	PrimaryLinkSection,
	PrimarySectionItemsDeps,
	TagSectionItemsDeps,
	TwoHopHeaderInteractionSnapshot,
	TwoHopHeaderSnapshot,
	TwoHopItemsDeps,
} from "./twohopPageTypes";
import {
	getBacklinkSearchKey,
	getMergedSearchKey,
	getOutgoingSearchKey,
	getTagNoteSearchKeyFromBaseKey,
	getTwohopBranchSearchBaseKey,
	createTwohopChildSearchKeyFromBaseKeys,
} from "./twohopSearchAdapter";

const EMPTY_HEADER_PROPS: ClickableHeaderExtraProps = {};

interface ResolveTwoHopDataIdentityParams {
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

export interface TwoHopDataIdentityCache {
	resolve(
		params: ResolveTwoHopDataIdentityParams,
	): readonly TwoHopSectionDescriptor[];
}

interface BranchEntry {
	applicationStore: ApplicationStore;
	branch: TwoHopLinkBranch;
	itemsDeps: TwoHopItemsDeps;
	itemsReconciler: StableViewItemReconciler<TwoHopIndexedLink>;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: () => readonly TwoHopPageVirtualItem[];
	getItem: (index: number) => TwoHopPageVirtualItem | undefined;
	headerSnapshot: TwoHopHeaderSnapshot;
	headerInteractionSnapshot: TwoHopHeaderInteractionSnapshot;
	headerProps: ClickableHeaderExtraProps;
	headerInteractionDescriptor: SectionHeaderInteractionDescriptor;
	descriptor: TwoHopSectionDescriptor;
}

interface TagEntry {
	applicationStore: ApplicationStore;
	source: TagGroup;
	itemsDeps: TagSectionItemsDeps;
	itemsReconciler: StableViewItemReconciler<TaggedNote>;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: () => readonly TwoHopPageVirtualItem[];
	getItem: (index: number) => TwoHopPageVirtualItem | undefined;
	tag: string;
	onTagClick: (tag: string) => void;
	headerProps: ClickableHeaderExtraProps;
	descriptor: TwoHopSectionDescriptor;
}

interface PrimaryEntry {
	source: PrimaryLinkSection;
	itemsDeps: PrimarySectionItemsDeps;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: () => readonly TwoHopPageVirtualItem[];
	getItem: (index: number) => TwoHopPageVirtualItem | undefined;
	descriptor: TwoHopSectionDescriptor;
}

interface NewLinksEntry {
	itemsDeps: NewLinksSectionItemsDeps;
	itemsAccessors: CachedVirtualItemAccessors;
	getItems: () => readonly TwoHopPageVirtualItem[];
	getItem: (index: number) => TwoHopPageVirtualItem | undefined;
	descriptor: TwoHopSectionDescriptor;
}

interface CachedVirtualItemAccessors {
	readonly getItems: () => readonly TwoHopPageVirtualItem[];
	readonly getItem: (index: number) => TwoHopPageVirtualItem | undefined;
	readonly reset: () => void;
}

const isBranchItem = (item: MergedLinkItem): item is TwoHopLinkBranch =>
	"hop1" in item && "hop2" in item;

const hasSameMergedItem = (current: MergedLinkItem, next: MergedLinkItem): boolean =>
	isBranchItem(current)
		? isBranchItem(next) && hasSameTwoHopBranchCard(current, next)
		: !isBranchItem(next) && hasSameBacklinkIndexedLink(current, next);

const getNewLinkViewItemKey = (item: ViewItem, index: number): string =>
	newLinksSectionConfig.getKey(item.data as TwoHopIndexedLink, index);

const createDescriptor = (
	section: TwoHopPageVirtualSection,
	searchQuery: string,
	totalCount: number,
	getItems: () => readonly TwoHopPageVirtualItem[],
	getItem: (index: number) => TwoHopPageVirtualItem | undefined = (index) =>
		getItems()[index],
	headerProps: ClickableHeaderExtraProps = EMPTY_HEADER_PROPS,
): TwoHopSectionDescriptor => {
	const immutableSection = Object.freeze(section);
	return Object.freeze({
		section: immutableSection,
		sectionKey: immutableSection.sectionKey,
		title: immutableSection.title,
		sectionId: immutableSection.rawSectionId,
		paginationKey: buildScopedSectionId(immutableSection.rawSectionId, searchQuery),
		totalCount,
		loadedCount: totalCount,
		getItems,
		getItem,
		headerProps,
	});
};

function hasDenseItemsCache(
	itemsCache: readonly (TwoHopPageVirtualItem | undefined)[] | undefined,
	length: number,
): itemsCache is readonly TwoHopPageVirtualItem[] {
	if (!itemsCache || itemsCache.length !== length) return false;
	for (let index = 0; index < length; index += 1) {
		if (!itemsCache[index]) return false;
	}
	return true;
}

function createSparseVirtualItemAccessors(params: {
	readonly getLength: () => number;
	readonly createItem: (index: number) => TwoHopPageVirtualItem | undefined;
}): CachedVirtualItemAccessors {
	let itemsCache: TwoHopPageVirtualItem[] | undefined;
	const getItem = (index: number): TwoHopPageVirtualItem | undefined => {
		const length = params.getLength();
		if (index < 0 || index >= length) return undefined;
		const cached = itemsCache?.[index];
		if (cached) return cached;

		const item = params.createItem(index);
		if (!item) return undefined;
		itemsCache ??= new Array<TwoHopPageVirtualItem>(length);
		itemsCache[index] = item;
		return item;
	};
	const getItems = (): readonly TwoHopPageVirtualItem[] => {
		const length = params.getLength();
		const cache =
			itemsCache && itemsCache.length === length
				? itemsCache
				: new Array<TwoHopPageVirtualItem>(length);
		itemsCache = cache;
		for (let index = 0; index < length; index += 1) {
			if (cache[index]) continue;
			const item = getItem(index);
			if (item) cache[index] = item;
		}
		return cache;
	};

	return {
		getItems,
		getItem,
		reset() {
			itemsCache = undefined;
		},
	};
}

function createDenseVirtualItemAccessors(params: {
	readonly getLength: () => number;
	readonly createItems: () => readonly TwoHopPageVirtualItem[];
}): CachedVirtualItemAccessors {
	let itemsCache: TwoHopPageVirtualItem[] | undefined;
	const getItems = (): readonly TwoHopPageVirtualItem[] => {
		const length = params.getLength();
		if (hasDenseItemsCache(itemsCache, length)) {
			return itemsCache;
		}

		itemsCache = [...params.createItems()];
		return itemsCache;
	};

	return {
		getItems,
		getItem(index) {
			const length = params.getLength();
			if (index < 0 || index >= length) return undefined;
			return getItems()[index];
		},
		reset() {
			itemsCache = undefined;
		},
	};
}

const hasSameDescriptorRefs = (
	current: readonly TwoHopSectionDescriptor[],
	next: readonly TwoHopSectionDescriptor[],
): boolean => {
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (current[index] !== next[index]) return false;
	}
	return true;
};

export function createTwoHopDataIdentityCache(): TwoHopDataIdentityCache {
	const outgoingItemsReconciler = createStableViewItemReconciler<TwoHopLinkBranch>({
		getKey: (item, index) => outgoingLinksSectionConfig.getKey(item, index),
		toViewItem: (item) => ({ type: "branch", data: item }),
		canReuseSource: hasSameTwoHopBranchCard,
	});
	const backlinksItemsReconciler = createStableViewItemReconciler<TwoHopIndexedLink>({
		getKey: (item, index) => backlinksSectionConfig.getKey(item, index),
		toViewItem: (item) => ({ type: "backlink", data: item }),
		canReuseSource: hasSameBacklinkIndexedLink,
	});
	const mergedItemsReconciler = createStableViewItemReconciler<MergedLinkItem>({
		getKey: (item, index) => mergedLinksSectionConfig.getKey(item, index),
		toViewItem: (item) =>
			isBranchItem(item)
				? { type: "branch", data: item }
				: { type: "backlink", data: item },
		canReuseSource: hasSameMergedItem,
	});
	const newLinksItemsReconciler = createStableViewItemReconciler<TwoHopIndexedLink>({
		getKey: (item, index) => newLinksSectionConfig.getKey(item, index),
		toViewItem: (item) => ({ type: "newLink", data: item }),
		canReuseSource: hasSameTwoHopIndexedLink,
	});

	const branchEntries = new Map<string, BranchEntry>();
	const tagEntries = new Map<string, TagEntry>();
	const primaryEntries = new Map<string, PrimaryEntry>();
	const newLinksEntries = new Map<string, NewLinksEntry>();
	const createItemInteractionToken = createInteractionTokenAllocator("i");
	const createHeaderInteractionToken = createInteractionTokenAllocator("h");
	let previousDescriptors: readonly TwoHopSectionDescriptor[] = [];

	const createItemInteractionIdentity = (
		item: ViewItem,
	): { interactionId: string; interactionKey: string } => {
		const interactionKey = createItemInteractionKey(item);
		return {
			interactionId: createItemInteractionToken(interactionKey),
			interactionKey,
		};
	};
	const createHeaderInteractionIdentity = (
		sectionId: string,
	): { interactionId: string; interactionKey: string } => {
		const interactionKey = createSectionHeaderInteractionKey(sectionId);
		return {
			interactionId: createHeaderInteractionToken(interactionKey),
			interactionKey,
		};
	};

	const createPrimarySections = (
		params: ResolveTwoHopDataIdentityParams,
	): PrimaryLinkSection[] => {
		if (params.useMergedLinks) {
			const items = mergedItemsReconciler.reconcile(
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
		const outgoing = outgoingItemsReconciler.reconcile(params.displayData.outgoing);
		const backlinks = backlinksItemsReconciler.reconcile(
			params.displayData.backlinks,
		);
		if (outgoing.length > 0) {
			sections.push({
				title: outgoingLinksSectionConfig.title,
				sectionId: outgoingLinksSectionConfig.sectionId,
				className: outgoingLinksSectionConfig.className,
				items: outgoing,
				getKey: (item, index) =>
					outgoingLinksSectionConfig.getKey(
						item.data as TwoHopLinkBranch,
						index,
					),
				getSearchKey: (item) =>
					getOutgoingSearchKey(item.data as TwoHopLinkBranch),
			});
		}
		if (backlinks.length > 0) {
			sections.push({
				title: backlinksSectionConfig.title,
				sectionId: backlinksSectionConfig.sectionId,
				className: backlinksSectionConfig.className,
				items: backlinks,
				getKey: (item, index) =>
					backlinksSectionConfig.getKey(
						item.data as TwoHopIndexedLink,
						index,
					),
				getSearchKey: (item) =>
					getBacklinkSearchKey(item.data as TwoHopIndexedLink),
			});
		}
		return sections;
	};

	return {
		resolve(params) {
			const descriptors: TwoHopSectionDescriptor[] = [];
			const activeBranchIds = new Set<string>();
			const activeTagIds = new Set<string>();
			const activePrimaryIds = new Set<string>();
			const activeNewLinksIds = new Set<string>();
			const seenFinalIds = SHOULD_VALIDATE_SECTION_IDS
				? new Map<string, number>()
				: null;
			const appendDescriptor = (descriptor: TwoHopSectionDescriptor): void => {
				if (descriptor.totalCount <= 0) return;
				const previousIndex = seenFinalIds?.get(descriptor.sectionId);
				if (previousIndex !== undefined) {
					throw new Error(
						`TwoHopDataIdentityCache: duplicate sectionId ${JSON.stringify(
							descriptor.sectionId,
						)} at indexes ${previousIndex} and ${descriptors.length}.`,
					);
				}
				seenFinalIds?.set(descriptor.sectionId, descriptors.length);
				descriptors.push(descriptor);
			};

			for (const source of createPrimarySections(params)) {
				const rawSectionId = source.sectionId;
				activePrimaryIds.add(rawSectionId);
				const nextDeps: PrimarySectionItemsDeps = {
					items: source.items,
					updateVersion: params.applicationStore.updateVersion,
				};
				let entry = primaryEntries.get(rawSectionId);
				if (!entry) {
					const created = {} as PrimaryEntry;
					created.source = source;
					created.itemsDeps = nextDeps;
					created.itemsAccessors = createSparseVirtualItemAccessors({
						getLength: () => created.source.items.length,
						createItem: (index) => {
							const item = created.source.items[index];
							if (!item) return undefined;
							return {
								kind: "primary-link" as const,
								item,
								...createItemInteractionIdentity(item),
								sourceSectionId: created.source.sectionId,
								searchKey: created.source.getSearchKey(item),
								virtualKey: created.source.getKey(item, index),
							};
						},
					});
					created.getItems = created.itemsAccessors.getItems;
					created.getItem = created.itemsAccessors.getItem;
					created.descriptor = createDescriptor(
						{
							kind: "primary-section",
							rawSectionId,
							sectionId: rawSectionId,
							sectionKey: rawSectionId,
							title: source.title,
							className: source.className,
							source,
						},
						params.searchQuery,
						source.items.length,
						created.getItems,
						created.getItem,
					);
					entry = created;
					primaryEntries.set(rawSectionId, entry);
				} else {
					const itemsChanged = !hasSamePrimaryItemsDeps(
						entry.itemsDeps,
						nextDeps,
					);
					const descriptorChanged =
						itemsChanged ||
						entry.source.title !== source.title ||
						entry.source.className !== source.className ||
						entry.descriptor.paginationKey !==
							buildScopedSectionId(rawSectionId, params.searchQuery);
					entry.source = source;
					entry.itemsDeps = nextDeps;
					if (itemsChanged) entry.itemsAccessors.reset();
					if (descriptorChanged) {
						entry.descriptor = createDescriptor(
							{
								kind: "primary-section",
								rawSectionId,
								sectionId: rawSectionId,
								sectionKey: rawSectionId,
								title: source.title,
								className: source.className,
								source,
							},
							params.searchQuery,
							source.items.length,
							entry.getItems,
							entry.getItem,
						);
					}
				}
				appendDescriptor(entry.descriptor);
			}

			for (const branch of params.displayData.twoHopBranches) {
				const sectionKey = generateBranchKey(branch);
				const rawSectionId = createCompactSectionId("twohop", sectionKey);
				activeBranchIds.add(rawSectionId);
				const targetFile =
					!branch.hop1.isUnresolved && branch.hop1.path
						? params.resolveFile(branch.hop1.path)
						: null;
				const title = targetFile
					? params.fileToLinktext(targetFile, params.sourceFile.path, true)
					: formatLinkText(branch.hop1);
				const nextHeaderInteractionSnapshot = {
					link: branch.hop1,
					targetFile,
					directory: targetFile?.parent?.path ?? null,
					settings: params.currentSettings,
				} satisfies TwoHopHeaderInteractionSnapshot;
				const nextHeaderSnapshot = {
					file: targetFile,
					className: branch.hop1.isUnresolved
						? "cosense-card-links__box--missing"
						: "cosense-card-links__box--existing",
					settings: params.currentSettings,
					directory: targetFile?.parent?.path ?? null,
				} satisfies TwoHopHeaderSnapshot;
				const nextItemsDeps: TwoHopItemsDeps = {
					hop2: branch.hop2,
					sortOption: params.currentSort,
					updateVersion: params.applicationStore.updateVersion,
					getSortedTwoHopItems: params.applicationStore.getSortedTwoHopItems,
				};
				let entry = branchEntries.get(rawSectionId);
				if (!entry) {
					const created = {} as BranchEntry;
					created.applicationStore = params.applicationStore;
					created.branch = branch;
					created.itemsDeps = nextItemsDeps;
					created.itemsReconciler =
						createStableViewItemReconciler<TwoHopIndexedLink>({
							getKey: (item) => generateBacklinkKey(item),
							toViewItem: (item) => ({ type: "backlink", data: item }),
							canReuseSource: hasSameBacklinkIndexedLink,
						});
					created.itemsAccessors = createDenseVirtualItemAccessors({
						getLength: () => created.branch.hop2.length,
						createItems: () => {
							const sorted = created.itemsDeps.getSortedTwoHopItems.call(
								created.applicationStore,
								created.branch.hop2,
							);
							const reconciled =
								created.itemsReconciler.reconcile(sorted);
							const reconciledKeys = created.itemsReconciler.getKeys();
							const branchBaseKey = getTwohopBranchSearchBaseKey(
								created.branch,
							);
							return reconciled.map((item, index) => ({
								kind: "two-hop-link" as const,
								item,
								...createItemInteractionIdentity(item),
								branch: created.branch,
								searchKey: createTwohopChildSearchKeyFromBaseKeys(
									branchBaseKey,
									reconciledKeys[index],
								),
								virtualKey: reconciledKeys[index],
							}));
						},
					});
					created.getItems = created.itemsAccessors.getItems;
					created.getItem = created.itemsAccessors.getItem;
					created.headerSnapshot = nextHeaderSnapshot;
					created.headerInteractionSnapshot = nextHeaderInteractionSnapshot;
					created.headerInteractionDescriptor =
						createHeaderInteractionDescriptor(
							rawSectionId,
							nextHeaderInteractionSnapshot,
							createHeaderInteractionIdentity(rawSectionId),
						);
					created.headerProps = {
						className: nextHeaderSnapshot.className,
						settings: nextHeaderSnapshot.settings,
						directory: nextHeaderSnapshot.directory,
						draggable: true,
						interactionId:
							created.headerInteractionDescriptor.interactionId,
						interactionKind: "sectionHeader",
						interactionDescriptor: created.headerInteractionDescriptor,
					};
					created.descriptor = createDescriptor(
						{
							kind: "two-hop-branch",
							rawSectionId,
							sectionId: rawSectionId,
							sectionKey,
							title,
							branch,
							headerProps: created.headerProps,
						},
						params.searchQuery,
						branch.hop2.length,
						created.getItems,
						created.getItem,
						created.headerProps,
					);
					entry = created;
					branchEntries.set(rawSectionId, entry);
				} else {
					const itemsChanged = !hasSameTwoHopItemsDeps(
						entry.itemsDeps,
						nextItemsDeps,
					);
					const headerChanged = !hasSameHeaderSnapshot(
						entry.headerSnapshot,
						nextHeaderSnapshot,
					);
					const interactionChanged = !hasSameHeaderInteractionSnapshot(
						entry.headerInteractionSnapshot,
						nextHeaderInteractionSnapshot,
					);
					entry.applicationStore = params.applicationStore;
					entry.branch = branch;
					entry.itemsDeps = nextItemsDeps;
					if (itemsChanged) entry.itemsAccessors.reset();
					if (interactionChanged) {
						entry.headerInteractionSnapshot = nextHeaderInteractionSnapshot;
						entry.headerInteractionDescriptor =
							createHeaderInteractionDescriptor(
								rawSectionId,
								nextHeaderInteractionSnapshot,
								createHeaderInteractionIdentity(rawSectionId),
							);
					}
					if (headerChanged || interactionChanged) {
						entry.headerSnapshot = nextHeaderSnapshot;
						entry.headerProps = {
							className: nextHeaderSnapshot.className,
							settings: nextHeaderSnapshot.settings,
							directory: nextHeaderSnapshot.directory,
							draggable: true,
							interactionId:
								entry.headerInteractionDescriptor.interactionId,
							interactionKind: "sectionHeader",
							interactionDescriptor: entry.headerInteractionDescriptor,
						};
					}
					if (
						itemsChanged ||
						headerChanged ||
						interactionChanged ||
						entry.descriptor.title !== title ||
						entry.descriptor.sectionKey !== sectionKey ||
						entry.descriptor.paginationKey !==
							buildScopedSectionId(rawSectionId, params.searchQuery)
					) {
						entry.descriptor = createDescriptor(
							{
								kind: "two-hop-branch",
								rawSectionId,
								sectionId: rawSectionId,
								sectionKey,
								title,
								branch,
								headerProps: entry.headerProps,
							},
							params.searchQuery,
							branch.hop2.length,
							entry.getItems,
							entry.getItem,
							entry.headerProps,
						);
					}
				}
				appendDescriptor(entry.descriptor);
			}

			if (params.showTags) {
				for (const source of params.displayData.tagGroups) {
					const rawSectionId = `tags-${source.tag}`;
					activeTagIds.add(rawSectionId);
					const nextItemsDeps: TagSectionItemsDeps = {
						notes: source.notes,
						sortOption: params.currentSort,
						updateVersion: params.applicationStore.updateVersion,
						getSortedTagGroupItems:
							params.applicationStore.getSortedTagGroupItems,
					};
					let entry = tagEntries.get(rawSectionId);
					if (!entry) {
						const created = {} as TagEntry;
						created.applicationStore = params.applicationStore;
						created.source = source;
						created.itemsDeps = nextItemsDeps;
						created.itemsReconciler =
							createStableViewItemReconciler<TaggedNote>({
								getKey: (item) =>
									generateLinkKey(
										item.file.path,
										item.file.basename,
										"tag-note",
									),
								toViewItem: (item) => ({
									type: "taggedNote",
									data: item,
								}),
								canReuseSource: hasSameTaggedNote,
							});
						created.tag = source.tag;
						created.onTagClick = params.onTagClick;
						created.headerProps = {
							className: "cosense-card-links__box--tag",
							interactionId:
								createHeaderInteractionIdentity(rawSectionId)
									.interactionId,
							interactionKind: "sectionHeader",
							onClick: () => created.onTagClick(created.tag),
						};
						created.itemsAccessors = createDenseVirtualItemAccessors({
							getLength: () => created.source.notes.length,
							createItems: () => {
								const sorted =
									created.itemsDeps.getSortedTagGroupItems.call(
										created.applicationStore,
										created.source.notes,
									);
								const reconciled =
									created.itemsReconciler.reconcile(sorted);
								const reconciledKeys = created.itemsReconciler.getKeys();
								return reconciled.map((item, index) => ({
									kind: "tag-link" as const,
									item,
									...createItemInteractionIdentity(item),
									tag: created.tag,
									searchKey: getTagNoteSearchKeyFromBaseKey(
										created.tag,
										reconciledKeys[index],
									),
									virtualKey: createTaggedNoteSectionItemKey(
										item,
										created.tag,
										index,
									),
								}));
							},
						});
						created.getItems = created.itemsAccessors.getItems;
						created.getItem = created.itemsAccessors.getItem;
						created.descriptor = createDescriptor(
							{
								kind: "tag-section",
								rawSectionId,
								sectionId: rawSectionId,
								sectionKey: `tag-${source.tag}`,
								title: `#${source.tag}`,
								tag: source.tag,
								headerProps: created.headerProps,
								className: "twohop-links-tags",
							},
							params.searchQuery,
							source.notes.length,
							created.getItems,
							created.getItem,
							created.headerProps,
						);
						entry = created;
						tagEntries.set(rawSectionId, entry);
					} else {
						const itemsChanged = !hasSameTagSectionItemsDeps(
							entry.itemsDeps,
							nextItemsDeps,
						);
						const callbackChanged = entry.onTagClick !== params.onTagClick;
						entry.applicationStore = params.applicationStore;
						entry.source = source;
						entry.itemsDeps = nextItemsDeps;
						entry.tag = source.tag;
						entry.onTagClick = params.onTagClick;
						if (itemsChanged) entry.itemsAccessors.reset();
						if (
							itemsChanged ||
							callbackChanged ||
							entry.descriptor.paginationKey !==
								buildScopedSectionId(rawSectionId, params.searchQuery)
						) {
							entry.descriptor = createDescriptor(
								{
									kind: "tag-section",
									rawSectionId,
									sectionId: rawSectionId,
									sectionKey: `tag-${source.tag}`,
									title: `#${source.tag}`,
									tag: source.tag,
									headerProps: entry.headerProps,
									className: "twohop-links-tags",
								},
								params.searchQuery,
								source.notes.length,
								entry.getItems,
								entry.getItem,
								entry.headerProps,
							);
						}
					}
					appendDescriptor(entry.descriptor);
				}
			}

			const newLinks = newLinksItemsReconciler.reconcile(
				params.displayData.newLinks,
			);
			if (newLinks.length > 0) {
				const rawSectionId = newLinksSectionConfig.sectionId;
				activeNewLinksIds.add(rawSectionId);
				const nextDeps: NewLinksSectionItemsDeps = {
					items: newLinks,
					updateVersion: params.applicationStore.updateVersion,
				};
				let entry = newLinksEntries.get(rawSectionId);
				if (!entry) {
					const created = {} as NewLinksEntry;
					created.itemsDeps = nextDeps;
					created.itemsAccessors = createSparseVirtualItemAccessors({
						getLength: () => created.itemsDeps.items.length,
						createItem: (index) => {
							const item = created.itemsDeps.items[index];
							if (!item) return undefined;
							const key = getNewLinkViewItemKey(item, index);
							return {
								kind: "new-link" as const,
								item,
								...createItemInteractionIdentity(item),
								searchKey: key,
								virtualKey: key,
							};
						},
					});
					created.getItems = created.itemsAccessors.getItems;
					created.getItem = created.itemsAccessors.getItem;
					created.descriptor = createDescriptor(
						{
							kind: "new-links-section",
							rawSectionId,
							sectionId: rawSectionId,
							sectionKey: rawSectionId,
							title: newLinksSectionConfig.title,
							className: newLinksSectionConfig.className,
							getKey: getNewLinkViewItemKey,
						},
						params.searchQuery,
						newLinks.length,
						created.getItems,
						created.getItem,
					);
					entry = created;
					newLinksEntries.set(rawSectionId, entry);
				} else {
					const itemsChanged = !hasSameNewLinksItemsDeps(
						entry.itemsDeps,
						nextDeps,
					);
					entry.itemsDeps = nextDeps;
					if (itemsChanged) entry.itemsAccessors.reset();
					if (
						itemsChanged ||
						entry.descriptor.paginationKey !==
							buildScopedSectionId(rawSectionId, params.searchQuery)
					) {
						entry.descriptor = createDescriptor(
							{
								kind: "new-links-section",
								rawSectionId,
								sectionId: rawSectionId,
								sectionKey: rawSectionId,
								title: newLinksSectionConfig.title,
								className: newLinksSectionConfig.className,
								getKey: getNewLinkViewItemKey,
							},
							params.searchQuery,
							newLinks.length,
							entry.getItems,
							entry.getItem,
						);
					}
				}
				appendDescriptor(entry.descriptor);
			}

			for (const key of branchEntries.keys()) {
				if (!activeBranchIds.has(key)) branchEntries.delete(key);
			}
			for (const key of tagEntries.keys()) {
				if (!activeTagIds.has(key)) tagEntries.delete(key);
			}
			for (const key of primaryEntries.keys()) {
				if (!activePrimaryIds.has(key)) primaryEntries.delete(key);
			}
			for (const key of newLinksEntries.keys()) {
				if (!activeNewLinksIds.has(key)) newLinksEntries.delete(key);
			}

			if (hasSameDescriptorRefs(previousDescriptors, descriptors)) {
				return previousDescriptors;
			}
			previousDescriptors = Object.freeze(descriptors);
			return previousDescriptors;
		},
	};
}
