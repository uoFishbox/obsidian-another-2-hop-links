import type { TFile } from "obsidian";
import type { ViewItem } from "application/presenters";
import type { TaggedNote, TwoHopIndexedLink, TwoHopLinkBranch } from "types/domain";
import { sameArrayBy, samePrimitiveArray } from "utils/arrayEquality";

export const hasSameTwoHopIndexedLink = (
	current: TwoHopIndexedLink,
	next: TwoHopIndexedLink,
): boolean => {
	if (current === next) return true;

	return (
		current.path === next.path &&
		current.lookupPath === next.lookupPath &&
		current.rawText === next.rawText &&
		current.displayText === next.displayText &&
		current.sourceFile.path === next.sourceFile.path &&
		(current.position?.start.offset ?? -1) ===
			(next.position?.start.offset ?? -1) &&
		(current.position?.end.offset ?? -1) === (next.position?.end.offset ?? -1) &&
		(current.backlinkCount ?? -1) === (next.backlinkCount ?? -1) &&
		current.isUnresolved === next.isUnresolved
	);
};

export const hasSameBacklinkIndexedLink = (
	current: TwoHopIndexedLink,
	next: TwoHopIndexedLink,
): boolean => {
	if (current === next) return true;

	return (
		current.sourceFile.path === next.sourceFile.path &&
		current.rawText === next.rawText &&
		(current.path ?? "") === (next.path ?? "") &&
		(current.lookupPath ?? "") === (next.lookupPath ?? "") &&
		(current.displayText ?? "") === (next.displayText ?? "") &&
		(current.key ?? "") === (next.key ?? "") &&
		(current.backlinkCount ?? -1) === (next.backlinkCount ?? -1) &&
		Boolean(current.isUnresolved) === Boolean(next.isUnresolved)
	);
};

export const hasSameTwoHopIndexedLinks = (
	current: readonly TwoHopIndexedLink[],
	next: readonly TwoHopIndexedLink[],
): boolean => sameArrayBy(current, next, hasSameTwoHopIndexedLink);

export const hasSameBacklinkIndexedLinks = (
	current: readonly TwoHopIndexedLink[],
	next: readonly TwoHopIndexedLink[],
): boolean => sameArrayBy(current, next, hasSameBacklinkIndexedLink);

export const hasSameTwoHopBranchCard = (
	current: Pick<TwoHopLinkBranch, "hop1">,
	next: Pick<TwoHopLinkBranch, "hop1">,
): boolean => {
	if (current === next) return true;

	const currentLink = current.hop1;
	const nextLink = next.hop1;
	if (currentLink === nextLink) return true;

	return (
		(currentLink.lookupPath ?? currentLink.path ?? currentLink.rawText) ===
			(nextLink.lookupPath ?? nextLink.path ?? nextLink.rawText) &&
		currentLink.rawText === nextLink.rawText &&
		(currentLink.path ?? "") === (nextLink.path ?? "") &&
		(currentLink.lookupPath ?? "") === (nextLink.lookupPath ?? "") &&
		(currentLink.displayText ?? "") === (nextLink.displayText ?? "") &&
		(currentLink.key ?? "") === (nextLink.key ?? "") &&
		Boolean(currentLink.isUnresolved) === Boolean(nextLink.isUnresolved)
	);
};

export const hasSameTaggedNote = (current: TaggedNote, next: TaggedNote): boolean => {
	if (current === next) return true;

	return (
		current.path === next.path &&
		current.file.path === next.file.path &&
		current.usageKey === next.usageKey &&
		current.position?.start.offset === next.position?.start.offset &&
		current.position?.end.offset === next.position?.end.offset &&
		samePrimitiveArray(current.commonTags, next.commonTags)
	);
};

export const hasSameTaggedNotes = (
	current: readonly TaggedNote[],
	next: readonly TaggedNote[],
): boolean => sameArrayBy(current, next, hasSameTaggedNote);

export const hasSameViewItemSource = (
	previousSource: ViewItem,
	nextSource: ViewItem,
): boolean => {
	if (previousSource === nextSource) {
		return true;
	}

	if (previousSource.type !== nextSource.type) {
		return false;
	}

	switch (previousSource.type) {
		case "branch": {
			const prev = previousSource as Extract<ViewItem, { type: "branch" }>;
			const next = nextSource as Extract<ViewItem, { type: "branch" }>;
			return (
				hasSameTwoHopIndexedLink(prev.data.hop1, next.data.hop1) &&
				hasSameBacklinkIndexedLinks(prev.data.hop2, next.data.hop2)
			);
		}
		case "backlink": {
			const prev = previousSource as Extract<ViewItem, { type: "backlink" }>;
			const next = nextSource as Extract<ViewItem, { type: "backlink" }>;
			return hasSameBacklinkIndexedLink(prev.data, next.data);
		}
		case "newLink": {
			const prev = previousSource as Extract<ViewItem, { type: "newLink" }>;
			const next = nextSource as Extract<ViewItem, { type: "newLink" }>;
			return hasSameTwoHopIndexedLink(prev.data, next.data);
		}
		case "taggedNote": {
			const prev = previousSource as Extract<ViewItem, { type: "taggedNote" }>;
			const next = nextSource as Extract<ViewItem, { type: "taggedNote" }>;
			return hasSameTaggedNote(prev.data, next.data);
		}
		case "file": {
			const previousFile = previousSource.data as TFile;
			const nextFile = nextSource.data as TFile;
			return (
				previousFile.path === nextFile.path &&
				previousFile.basename === nextFile.basename &&
				previousFile.extension === nextFile.extension &&
				previousFile.stat.ctime === nextFile.stat.ctime &&
				previousFile.stat.mtime === nextFile.stat.mtime &&
				previousFile.stat.size === nextFile.stat.size
			);
		}
		default:
			return false;
	}
};
