import type { TFile } from "obsidian";
import type { CardItem } from "cards/CardItem";
import type { DisplayData, MergedLinkItem } from "two-hop/display/displayDataBuilder";
import {
	formatLinkText,
	generateBacklinkKey,
	generateBranchCardKey,
	generateIndexedLinkKey,
	generateLinkKey,
} from "card-preview/text/textUtils";
import {
	getBacklinkSearchKey,
	getMergedSearchKey,
	getOutgoingSearchKey,
	createTwohopChildSearchKeyFromBaseKeys,
	getTagNoteSearchKeyFromBaseKey,
	getTwohopBranchSearchBaseKey,
} from "two-hop/ui/twoHopSearchAdapter";
import {
	createTaggedNoteSectionItemKey,
	createTwoHopSectionModel,
	type ClickableHeaderExtraProps,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "two-hop/ui/twoHopSectionModel";
import {
	createItemInteractionKey,
	createSectionHeaderInteractionKey,
	type InteractionSettings,
	type SectionHeaderInteractionDescriptor,
} from "cards/interactions/interactionTypes";
import type { TaggedNote, IndexedLink } from "indexing/model";
import type { TagGroup, TwoHopLinkBranch } from "two-hop/model";
import type { Language } from "settings/model";
import { getMainUiTranslations } from "shared/i18n/mainUiTranslations";

/** Stable publication and section identity for the new-links section. */
export const NEW_LINKS_SECTION_ID = "newlinks";

/** Materializes only the requested prefix while preserving existing item identities. */
function materializeItemPrefix<T>(
	sources: readonly T[],
	itemLimit: number,
	previousItems: readonly TwoHopItemModel[],
	createItem: (source: T, index: number) => TwoHopItemModel,
): readonly TwoHopItemModel[] {
	const itemCount = Math.min(sources.length, Math.max(0, Math.floor(itemLimit)));
	if (previousItems.length === itemCount) return previousItems;

	const items = previousItems.slice(0, itemCount);
	for (let index = items.length; index < itemCount; index += 1) {
		const source = sources[index];
		if (source === undefined) break;
		items.push(createItem(source, index));
	}
	return items;
}

export type PrimarySectionBuildInput =
	| {
			readonly kind: "outgoing";
			readonly items: DisplayData["outgoing"];
	  }
	| {
			readonly kind: "backlinks";
			readonly items: DisplayData["backlinks"];
	  }
	| {
			readonly kind: "merged";
			readonly items: DisplayData["mergedItems"];
	  };

export interface CreatePrimarySectionDescriptorParams {
	readonly input: PrimarySectionBuildInput;
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly language: Language;
}

/**
 * Builds one immutable primary-section publication.
 *
 * Only the published prefix is materialized; viewport reads remain
 * allocation-free and later expansions reuse existing item models.
 */
export function createPrimarySectionDescriptor(
	params: CreatePrimarySectionDescriptorParams,
): TwoHopSectionModel {
	switch (params.input.kind) {
		case "outgoing":
			return createPrimaryDescriptor({
				items: params.input.items,
				itemLimit: params.itemLimit,
				previousItems: params.previousItems,
				sectionId: "outgoing",
				toCardItem: (item) => ({ type: "branch", data: item }),
				getSearchKey: getOutgoingSearchKey,
				getVirtualKey: (item) => generateBranchCardKey(item),
				title: getMainUiTranslations(params.language).outgoingLinks,
			});
		case "backlinks":
			return createPrimaryDescriptor({
				items: params.input.items,
				itemLimit: params.itemLimit,
				previousItems: params.previousItems,
				sectionId: "backlinks",
				toCardItem: (item) => ({ type: "backlink", data: item }),
				getSearchKey: getBacklinkSearchKey,
				getVirtualKey: (item) => generateBacklinkKey(item, "backlink"),
				title: getMainUiTranslations(params.language).backlinks,
			});
		case "merged":
			return createPrimaryDescriptor({
				items: params.input.items,
				itemLimit: params.itemLimit,
				previousItems: params.previousItems,
				sectionId: "merged",
				toCardItem: toMergedViewItem,
				getSearchKey: getMergedSearchKey,
				getVirtualKey: resolveMergedVirtualKey,
				title: getMainUiTranslations(params.language).links,
			});
	}
}

interface CreatePrimaryDescriptorParams<T> {
	readonly items: readonly T[];
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly sectionId: string;
	readonly toCardItem: (item: T) => CardItem;
	readonly getSearchKey: (item: T) => string;
	readonly getVirtualKey: (item: T, index: number) => string;
	readonly title: string;
}

function createPrimaryDescriptor<T>(
	params: CreatePrimaryDescriptorParams<T>,
): TwoHopSectionModel {
	const rows = materializeItemPrefix(
		params.items,
		params.itemLimit,
		params.previousItems,
		(source, index): TwoHopItemModel => {
			const item = params.toCardItem(source);
			const virtualKey = params.getVirtualKey(source, index);
			return {
				item,
				interactionId: createItemInteractionKey(item, virtualKey),
				searchKey: params.getSearchKey(source),
				key: virtualKey,
			};
		},
	);
	return createTwoHopSectionModel({
		kind: "primary-section",
		id: params.sectionId,
		title: params.title,
		items: rows,
		totalCount: params.items.length,
	});
}

function resolveMergedVirtualKey(item: MergedLinkItem): string {
	return "hop1" in item && "hop2" in item
		? generateBranchCardKey(item, "outgoing")
		: generateBacklinkKey(item, "backlink");
}

function toMergedViewItem(item: MergedLinkItem): CardItem {
	return "hop1" in item
		? { type: "branch", data: item }
		: { type: "backlink", data: item };
}

export interface BranchSectionBuildInput {
	readonly branch: TwoHopLinkBranch;
	readonly rawSectionId: string;
	readonly sourceFile: TFile;
	readonly targetFile: TFile | null;
	readonly title: string;
	readonly className: string;
	readonly interactionSettings: InteractionSettings;
	readonly sortedItems: readonly IndexedLink[];
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
}

/**
 * Resolves the display-only header values used by both the signature and
 * immutable branch publication.
 */
export function resolveBranchHeader(params: {
	readonly branch: TwoHopLinkBranch;
	readonly sourceFile: TFile;
	readonly resolveFile: (path: string) => TFile | null;
	readonly fileToLinktext: (
		file: TFile,
		sourcePath: string,
		omitMdExtension?: boolean,
	) => string;
}): Pick<BranchSectionBuildInput, "targetFile" | "title" | "className"> {
	const targetFile =
		!params.branch.hop1.isUnresolved && params.branch.hop1.path
			? params.resolveFile(params.branch.hop1.path)
			: null;

	return {
		targetFile,
		title: targetFile
			? params.fileToLinktext(targetFile, params.sourceFile.path, true)
			: formatLinkText(params.branch.hop1),
		className: params.branch.hop1.isUnresolved
			? "cosense-card-links__box--missing"
			: "cosense-card-links__box--existing",
	};
}

/** Builds one immutable branch publication from a sorted, bounded prefix. */
export function createBranchSectionDescriptor(
	input: BranchSectionBuildInput,
): TwoHopSectionModel {
	const branchBaseKey = getTwohopBranchSearchBaseKey(input.branch);
	const rows = materializeItemPrefix(
		input.sortedItems,
		input.itemLimit,
		input.previousItems,
		(source): TwoHopItemModel => {
			const item: CardItem = { type: "backlink", data: source };
			const virtualKey = generateBacklinkKey(source);
			return {
				item,
				interactionId: createItemInteractionKey(item, virtualKey),
				searchKey: createTwohopChildSearchKeyFromBaseKeys(
					branchBaseKey,
					virtualKey,
				),
				key: virtualKey,
			};
		},
	);
	const headerInteractionDescriptor: SectionHeaderInteractionDescriptor = {
		interactionId: createSectionHeaderInteractionKey(input.rawSectionId),
		kind: "sectionHeader",
		link: input.branch.hop1,
		isOutgoingLink: true,
		targetFile: input.targetFile,
		hoverPreviewEnabled: !!input.targetFile,
		dragRawText: input.branch.hop1.rawText,
		filePathForDrag: input.targetFile?.path,
		settings: input.interactionSettings,
	};
	const headerProps: ClickableHeaderExtraProps = {
		className: input.className,
		draggable: true,
		interactionDescriptor: headerInteractionDescriptor,
	};

	return createTwoHopSectionModel({
		kind: "two-hop-branch",
		id: input.rawSectionId,
		title: input.title,
		headerProps,
		items: rows,
		totalCount: input.sortedItems.length,
	});
}

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
): TwoHopSectionModel {
	const headerProps: ClickableHeaderExtraProps = {
		className: "cosense-card-links__box--tag",
		onClick: () => input.onTagClick(input.source.tag),
	};
	const rows = materializeItemPrefix(
		input.sortedItems,
		input.itemLimit,
		input.previousItems,
		(source, index): TwoHopItemModel => {
			const item: CardItem = { type: "taggedNote", data: source };
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
			return {
				item,
				interactionId: createItemInteractionKey(item, virtualKey),
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

export interface CreateNewLinksSectionDescriptorParams {
	readonly items: readonly IndexedLink[];
	readonly itemLimit: number;
	readonly previousItems: readonly TwoHopItemModel[];
	readonly language: Language;
}

/** Builds an immutable new-links publication with allocation-free viewport reads. */
export function createNewLinksSectionDescriptor(
	params: CreateNewLinksSectionDescriptorParams,
): TwoHopSectionModel {
	const rows = materializeItemPrefix(
		params.items,
		params.itemLimit,
		params.previousItems,
		(source): TwoHopItemModel => {
			const item: CardItem = { type: "newLink", data: source };
			const virtualKey = generateIndexedLinkKey(source, "new");
			return {
				item,
				interactionId: createItemInteractionKey(item, virtualKey),
				searchKey: virtualKey,
				key: virtualKey,
			};
		},
	);
	return createTwoHopSectionModel({
		kind: "new-links-section",
		id: NEW_LINKS_SECTION_ID,
		title: getMainUiTranslations(params.language).newLinks,
		items: rows,
		totalCount: params.items.length,
	});
}
