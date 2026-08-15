import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type { ClickableHeaderExtraProps } from "ui/components/sections/types";
import {
	createItemInteractionKey,
	type InteractionSettings,
	type SectionHeaderInteractionDescriptor,
} from "ui/interactions/interactionTypes";
import {
	formatLinkText,
	generateBacklinkKey,
} from "features/card-preview/text-processing/textUtils";
import type { TwoHopLinkBranch } from "types/domain";
import type { TwoHopIndexedLink } from "types/domain";
import {
	createTwoHopSectionModel,
	type TwoHopItemModel,
	type TwoHopSectionModel,
} from "features/two-hop/ui/twoHopSectionModel";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import { materializeItemPrefix } from "./materializeItemPrefix";
import {
	createTwohopChildSearchKeyFromBaseKeys,
	getTwohopBranchSearchBaseKey,
} from "features/two-hop/ui/twoHopSearchAdapter";

export interface BranchSectionBuildInput {
	readonly branch: TwoHopLinkBranch;
	readonly rawSectionId: string;
	readonly sourceFile: TFile;
	readonly targetFile: TFile | null;
	readonly title: string;
	readonly className: string;
	readonly interactionSettings: InteractionSettings;
	readonly sortedItems: readonly TwoHopIndexedLink[];
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
	tokens: TwoHopInteractionTokenAllocator,
): TwoHopSectionModel {
	const branchBaseKey = getTwohopBranchSearchBaseKey(input.branch);
	const rows = materializeItemPrefix(
		input.sortedItems,
		input.itemLimit,
		input.previousItems,
		(source): TwoHopItemModel => {
			const item: ViewItem = { type: "backlink", data: source };
			const virtualKey = generateBacklinkKey(source);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				item,
				interactionId: tokens.createItemInteractionToken(interactionKey),
				interactionKey,
				searchKey: createTwohopChildSearchKeyFromBaseKeys(
					branchBaseKey,
					virtualKey,
				),
				key: virtualKey,
			};
		},
	);
	const headerInteractionIdentity = tokens.createHeaderInteractionIdentity(
		input.rawSectionId,
	);
	const headerInteractionDescriptor: SectionHeaderInteractionDescriptor = {
		...headerInteractionIdentity,
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
		interactionId: headerInteractionDescriptor.interactionId,
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
