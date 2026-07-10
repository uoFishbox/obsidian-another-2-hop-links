import {
	hasSameBacklinkIndexedLinks,
	hasSameTaggedNotes,
	hasSameTwoHopIndexedLink,
} from "ui/utils/twohopEquality";
import { createSectionHeaderInteractionKey } from "ui/interactions/interactionTypes";
import type { SectionHeaderInteractionDescriptor } from "ui/interactions/interactionTypes";
import type {
	TwoHopHeaderSnapshot,
	TwoHopHeaderInteractionSnapshot,
	TwoHopItemsDeps,
	TagSectionItemsDeps,
	PrimarySectionItemsDeps,
	NewLinksSectionItemsDeps,
} from "./twoHopPageTypes";

export function hasSameTwoHopItemsDeps(
	current: TwoHopItemsDeps,
	next: TwoHopItemsDeps,
): boolean {
	return (
		(current.hop2 === next.hop2 ||
			hasSameBacklinkIndexedLinks(current.hop2, next.hop2)) &&
		current.sortOption === next.sortOption &&
		current.sortContextVersion === next.sortContextVersion &&
		current.getSortedTwoHopItems === next.getSortedTwoHopItems
	);
}

export function hasSameHeaderSnapshot(
	current: TwoHopHeaderSnapshot,
	next: TwoHopHeaderSnapshot,
): boolean {
	return (
		current.file === next.file &&
		current.className === next.className &&
		current.settings === next.settings &&
		current.directory === next.directory
	);
}

export function hasSameHeaderInteractionSnapshot(
	current: TwoHopHeaderInteractionSnapshot,
	next: TwoHopHeaderInteractionSnapshot,
): boolean {
	return (
		(current.link === next.link ||
			hasSameTwoHopIndexedLink(current.link, next.link)) &&
		current.targetFile === next.targetFile &&
		current.directory === next.directory &&
		current.settings === next.settings
	);
}

export function hasSameTagSectionItemsDeps(
	current: TagSectionItemsDeps,
	next: TagSectionItemsDeps,
): boolean {
	return (
		(current.notes === next.notes ||
			hasSameTaggedNotes(current.notes, next.notes)) &&
		current.sortOption === next.sortOption &&
		current.updateVersion === next.updateVersion &&
		current.getSortedTagGroupItems === next.getSortedTagGroupItems
	);
}

export function hasSamePrimaryItemsDeps(
	current: PrimarySectionItemsDeps,
	next: PrimarySectionItemsDeps,
): boolean {
	return current.items === next.items && current.updateVersion === next.updateVersion;
}

export function hasSameNewLinksItemsDeps(
	current: NewLinksSectionItemsDeps,
	next: NewLinksSectionItemsDeps,
): boolean {
	return current.items === next.items && current.updateVersion === next.updateVersion;
}

export function createHeaderInteractionDescriptor(
	sectionId: string,
	snapshot: TwoHopHeaderInteractionSnapshot,
	options: {
		interactionId?: string;
		interactionKey?: string;
	} = {},
): SectionHeaderInteractionDescriptor {
	const interactionKey =
		options.interactionKey ?? createSectionHeaderInteractionKey(sectionId);
	return {
		interactionId: options.interactionId ?? interactionKey,
		interactionKey,
		kind: "sectionHeader",
		link: snapshot.link,
		isOutgoingLink: true,
		targetFile: snapshot.targetFile,
		hoverPreviewEnabled: !!snapshot.targetFile,
		dragRawText: snapshot.link.rawText,
		filePathForDrag: snapshot.targetFile?.path,
		directory: snapshot.directory,
		settings: snapshot.settings,
	};
}
