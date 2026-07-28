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
} from "features/preview/text-processing/textUtils";
import type { TwoHopLinkBranch } from "types/domain";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	type TwoHopVirtualListItem,
	type TwoHopVirtualSectionDescriptor,
} from "features/two-hop/ui/twoHopVirtualListModel";
import {
	createDescriptor,
	createEagerVirtualItemAccessors,
} from "./descriptorIdentity";
import type { TwoHopInteractionTokenAllocator } from "./interactionTokenAllocator";
import {
	createTwohopChildSearchKeyFromBaseKeys,
	getTwohopBranchSearchBaseKey,
} from "features/two-hop/ui/twoHopSearchAdapter";

export interface BranchSectionBuildInput {
	readonly branch: TwoHopLinkBranch;
	readonly rawSectionId: string;
	readonly sectionKey: string;
	readonly sourceFile: TFile;
	readonly targetFile: TFile | null;
	readonly title: string;
	readonly className: string;
	readonly directory: string | null;
	readonly interactionSettings: InteractionSettings;
	readonly applicationStore: ApplicationStore;
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
}): Pick<BranchSectionBuildInput, "targetFile" | "title" | "className" | "directory"> {
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
		directory: targetFile?.parent?.path ?? null,
	};
}

/** Builds one immutable branch publication with eager sorting and rows. */
export function createBranchSectionDescriptor(
	input: BranchSectionBuildInput,
	tokens: TwoHopInteractionTokenAllocator,
): TwoHopVirtualSectionDescriptor {
	const branchBaseKey = getTwohopBranchSearchBaseKey(input.branch);
	const sortedItems = input.applicationStore.getSortedTwoHopItems(input.branch.hop2);
	const rows: readonly TwoHopVirtualListItem[] = sortedItems.map(
		(source): TwoHopVirtualListItem => {
			const item: ViewItem = { type: "backlink", data: source };
			const virtualKey = generateBacklinkKey(source);
			const interactionKey = createItemInteractionKey(item, virtualKey);
			return {
				kind: "two-hop-link",
				item,
				interactionId: tokens.createItemInteractionToken(interactionKey),
				interactionKey,
				branch: input.branch,
				searchKey: createTwohopChildSearchKeyFromBaseKeys(
					branchBaseKey,
					virtualKey,
				),
				virtualKey,
			};
		},
	);
	const accessors = createEagerVirtualItemAccessors(rows);
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
		directory: input.directory,
		settings: input.interactionSettings,
	};
	const headerProps: ClickableHeaderExtraProps = {
		className: input.className,
		directory: input.directory,
		draggable: true,
		interactionId: headerInteractionDescriptor.interactionId,
		interactionKind: "sectionHeader",
		interactionDescriptor: headerInteractionDescriptor,
	};

	return createDescriptor(
		{
			kind: "two-hop-branch",
			rawSectionId: input.rawSectionId,
			sectionId: input.rawSectionId,
			sectionKey: input.sectionKey,
			title: input.title,
			branch: input.branch,
			headerProps,
		},
		rows.length,
		accessors.getItems,
		accessors.getItem,
		headerProps,
	);
}
