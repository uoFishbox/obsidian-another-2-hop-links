import type { TFile } from "obsidian";
import type { MergedLinkItem } from "features/two-hop/application/displayDataBuilder";
import type { SortOption } from "features/settings/model";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { InteractionSettings } from "ui/interactions/interactionTypes";
import {
	hasSameBacklinkIndexedLink,
	hasSameBacklinkIndexedLinks,
	hasSameTaggedNotes,
	hasSameTwoHopIndexedLink,
} from "features/two-hop/shared/twoHopEquality";
import type { TagGroup, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import type { PrimarySectionBuildInput } from "./createPrimaryDescriptor";

/** Semantic inputs that determine one immutable section publication. */
export type SectionSignature =
	| {
			readonly kind: "primary";
			readonly input: PrimarySectionBuildInput;
	  }
	| {
			readonly kind: "branch";
			readonly branch: TwoHopLinkBranch;
			readonly rawSectionId: string;
			readonly sectionKey: string;
			readonly targetFile: TFile | null;
			readonly title: string;
			readonly className: string;
			readonly directory: string | null;
			readonly sortOption: SortOption;
			readonly sortContextVersion: number;
			readonly getSortedItems: ApplicationStore["getSortedTwoHopItems"];
			readonly interactionSettings: InteractionSettings;
	  }
	| {
			readonly kind: "tag";
			readonly source: TagGroup;
			readonly rawSectionId: string;
			readonly sortOption: SortOption;
			readonly sortContextVersion: number;
			readonly getSortedItems: ApplicationStore["getSortedTagGroupItems"];
	  }
	| {
			readonly kind: "new-links";
			readonly items: readonly TwoHopIndexedLink[];
	  };

export function hasSameSectionSignature(
	current: SectionSignature,
	next: SectionSignature,
): boolean {
	if (current.kind !== next.kind) return false;

	switch (current.kind) {
		case "primary":
			return (
				next.kind === "primary" &&
				hasSamePrimaryInput(current.input, next.input)
			);
		case "branch":
			return (
				next.kind === "branch" &&
				current.rawSectionId === next.rawSectionId &&
				current.sectionKey === next.sectionKey &&
				hasSameBranch(current.branch, next.branch) &&
				current.targetFile === next.targetFile &&
				current.title === next.title &&
				current.className === next.className &&
				current.directory === next.directory &&
				current.sortOption === next.sortOption &&
				current.sortContextVersion === next.sortContextVersion &&
				current.getSortedItems === next.getSortedItems &&
				hasSameInteractionSettings(
					current.interactionSettings,
					next.interactionSettings,
				)
			);
		case "tag":
			return (
				next.kind === "tag" &&
				current.rawSectionId === next.rawSectionId &&
				current.source.tag === next.source.tag &&
				hasSameTaggedNotes(current.source.notes, next.source.notes) &&
				current.sortOption === next.sortOption &&
				current.sortContextVersion === next.sortContextVersion &&
				current.getSortedItems === next.getSortedItems
			);
		case "new-links":
			return (
				next.kind === "new-links" &&
				hasSameIndexedLinks(current.items, next.items)
			);
	}
}

function hasSamePrimaryInput(
	current: PrimarySectionBuildInput,
	next: PrimarySectionBuildInput,
): boolean {
	if (current.kind !== next.kind) return false;
	switch (current.kind) {
		case "outgoing":
			return (
				next.kind === "outgoing" && hasSameBranches(current.items, next.items)
			);
		case "backlinks":
			return (
				next.kind === "backlinks" &&
				hasSameBacklinkIndexedLinks(current.items, next.items)
			);
		case "merged":
			return (
				next.kind === "merged" && hasSameMergedItems(current.items, next.items)
			);
	}
}

function hasSameBranches(
	current: readonly TwoHopLinkBranch[],
	next: readonly TwoHopLinkBranch[],
): boolean {
	if (current === next) return true;
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (!hasSameBranch(current[index], next[index])) return false;
	}
	return true;
}

function hasSameBranch(current: TwoHopLinkBranch, next: TwoHopLinkBranch): boolean {
	return (
		current === next ||
		(hasSameTwoHopIndexedLink(current.hop1, next.hop1) &&
			hasSameBacklinkIndexedLinks(current.hop2, next.hop2))
	);
}

function hasSameIndexedLinks(
	current: readonly TwoHopIndexedLink[],
	next: readonly TwoHopIndexedLink[],
): boolean {
	if (current === next) return true;
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (!hasSameTwoHopIndexedLink(current[index], next[index])) return false;
	}
	return true;
}

function hasSameMergedItems(
	current: readonly MergedLinkItem[],
	next: readonly MergedLinkItem[],
): boolean {
	if (current === next) return true;
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		const currentItem = current[index];
		const nextItem = next[index];
		const currentIsBranch = "hop1" in currentItem;
		const nextIsBranch = "hop1" in nextItem;
		if (currentIsBranch !== nextIsBranch) return false;
		if (currentIsBranch && nextIsBranch) {
			if (!hasSameBranch(currentItem, nextItem)) return false;
			continue;
		}
		if (
			!currentIsBranch &&
			!nextIsBranch &&
			!hasSameBacklinkIndexedLink(currentItem, nextItem)
		) {
			return false;
		}
	}
	return true;
}

function hasSameInteractionSettings(
	current: InteractionSettings,
	next: InteractionSettings,
): boolean {
	return (
		current.mobileLongPressAction === next.mobileLongPressAction &&
		current.highlightInPreviewOnHover === next.highlightInPreviewOnHover
	);
}
