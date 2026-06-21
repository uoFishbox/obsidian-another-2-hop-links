import type { CachedMetadata, TFile } from "obsidian";
import type { SearchWorkerItemSnapshot } from "features/search/searchWorkerTypes";
import {
	buildSearchWorkerItemSnapshot,
	getBranchSearchText,
	getTagGroupSearchText,
	type FileToLinktext,
} from "features/search/searchSnapshotBuilders";
import {
	createBacklinkIdentitySignature,
	createBranchIdentitySignature,
	createLinkIdentitySignature,
} from "core/signatures/keySignatures";
import type {
	DisplayData,
	MergedLinkItem,
} from "application/presenters/displayDataBuilder";
import type {
	TagGroup,
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
} from "types/domain";
import { getFileCardTitleSearchText } from "core/frontmatterCardTitle";

const SEARCH_KEY_SEPARATOR = "\u001f";
const OUTGOING_SEARCH_PREFIX = "o";
const BACKLINK_SEARCH_PREFIX = "b";
const MERGED_SEARCH_PREFIX = "m";
const TWOHOP_CHILD_SEARCH_PREFIX = "h";
const TAG_GROUP_SEARCH_PREFIX = "g";
const TAG_NOTE_SEARCH_PREFIX = "n";

function filterWithReferenceReuse<T>(
	items: readonly T[],
	predicate: (item: T) => boolean,
): T[] {
	let changed = false;
	const next: T[] = [];

	for (const item of items) {
		if (predicate(item)) {
			next.push(item);
		} else {
			changed = true;
		}
	}

	return changed ? next : (items as T[]);
}

export interface TwohopSearchAdapterOptions {
	displayData: DisplayData;
	resolveFile: (path: string) => TFile | null;
	fileToLinktext: FileToLinktext;
	sourcePath: string;
	getMetadata: (file: TFile) => CachedMetadata | null;
	priorityFrontmatterKeyForTitle?: string;
}

export function collectTwohopSearchableFiles(
	options: TwohopSearchAdapterOptions,
): TFile[] {
	const filesByPath = new Map<string, TFile>();
	const addFile = (targetFile: TFile | null | undefined) => {
		if (!targetFile) {
			return;
		}
		filesByPath.set(targetFile.path, targetFile);
	};

	for (const branch of options.displayData.outgoing) {
		addFile(getBranchTargetFile(branch, options.resolveFile));
	}
	for (const link of options.displayData.backlinks) {
		addFile(link.sourceFile);
	}
	for (const item of options.displayData.mergedItems) {
		if (isBranchItem(item)) {
			addFile(getBranchTargetFile(item, options.resolveFile));
		} else {
			addFile(item.sourceFile);
		}
	}
	for (const branch of options.displayData.twoHopBranches) {
		addFile(getBranchTargetFile(branch, options.resolveFile));
		for (const link of branch.hop2) {
			addFile(link.sourceFile);
		}
	}
	for (const section of options.displayData.tagGroups) {
		for (const note of section.notes) {
			addFile(note.file);
		}
	}

	return Array.from(filesByPath.values());
}

export function buildTwohopSearchDataset(
	options: TwohopSearchAdapterOptions,
): SearchWorkerItemSnapshot[] {
	const snapshots: SearchWorkerItemSnapshot[] = [];
	const { displayData, resolveFile } = options;

	const getFileTitleSearchText = (file: TFile): string =>
		getFileCardTitleSearchText(file, {
			sourcePath: options.sourcePath,
			fileToLinktext: options.fileToLinktext,
			getMetadata: options.getMetadata,
			priorityFrontmatterKeyForTitle:
				options.priorityFrontmatterKeyForTitle,
		});

	const getBranchTitleSearchText = (branch: TwoHopLinkBranch): string => {
		const targetFile = getBranchTargetFile(branch, resolveFile);
		if (!targetFile) {
			return getBranchSearchText(branch.hop1);
		}

		return [
			getFileTitleSearchText(targetFile),
			getBranchSearchText(branch.hop1),
		]
			.filter(Boolean)
			.join(" ");
	};

	for (const branch of displayData.outgoing) {
		snapshots.push(
			buildSearchWorkerItemSnapshot(
				getOutgoingSearchKey(branch),
				getBranchTitleSearchText(branch),
				getBranchTargetFile(branch, resolveFile)?.path ?? null,
			),
		);
	}

	for (const link of displayData.backlinks) {
		snapshots.push(
			buildSearchWorkerItemSnapshot(
				getBacklinkSearchKey(link),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile.path,
			),
		);
	}

	for (const item of displayData.mergedItems) {
		if (isBranchItem(item)) {
			snapshots.push(
				buildSearchWorkerItemSnapshot(
					getMergedSearchKey(item),
					getBranchTitleSearchText(item),
					getBranchTargetFile(item, resolveFile)?.path ?? null,
				),
			);
			continue;
		}

		snapshots.push(
			buildSearchWorkerItemSnapshot(
				getMergedSearchKey(item),
				getFileTitleSearchText(item.sourceFile),
				item.sourceFile.path,
			),
		);
	}

	for (const branch of displayData.twoHopBranches) {
		const branchBaseKey = getTwohopBranchSearchBaseKey(branch);
		for (const link of branch.hop2) {
			snapshots.push(
				buildSearchWorkerItemSnapshot(
					getTwohopChildSearchKeyFromBranchBaseKey(
						branchBaseKey,
						link,
					),
					getFileTitleSearchText(link.sourceFile),
					link.sourceFile.path,
				),
			);
		}
	}

	for (const section of displayData.tagGroups) {
		snapshots.push(
			buildSearchWorkerItemSnapshot(
				getTagGroupSearchKey(section),
				getTagGroupSearchText(section.tag),
				null,
			),
		);

		for (const note of section.notes) {
			snapshots.push(
				buildSearchWorkerItemSnapshot(
					getTagNoteSearchKey(section, note),
					getFileTitleSearchText(note.file),
					note.file.path,
				),
			);
		}
	}

	return snapshots;
}

export function filterTwohopDisplayData(
	displayData: DisplayData,
	query: string,
	matchedKeySet: Set<string> | null,
): DisplayData {
	if (!query) {
		return displayData;
	}

	if (!matchedKeySet) {
		return {
			...displayData,
			outgoing: [],
			backlinks: [],
			mergedItems: [],
			twoHopBranches: [],
			tagGroups: [],
			newLinks: [],
		};
	}

	const twoHopBranches: TwoHopLinkBranch[] = [];
	for (const branch of displayData.twoHopBranches) {
		const filteredBranch = filterTwohopBranch(branch, matchedKeySet);
		if (filteredBranch) {
			twoHopBranches.push(filteredBranch);
		}
	}
	const tagGroups: TagGroup[] = [];
	for (const section of displayData.tagGroups) {
		const filteredSection = filterTagGroup(section, matchedKeySet);
		if (filteredSection) {
			tagGroups.push(filteredSection);
		}
	}

	return {
		...displayData,
		outgoing: filterWithReferenceReuse(displayData.outgoing, (branch) =>
			matchedKeySet.has(getOutgoingSearchKey(branch)),
		),
		backlinks: filterWithReferenceReuse(displayData.backlinks, (link) =>
			matchedKeySet.has(getBacklinkSearchKey(link)),
		),
		mergedItems: filterWithReferenceReuse(displayData.mergedItems, (item) =>
			matchedKeySet.has(getMergedSearchKey(item)),
		),
		twoHopBranches,
		tagGroups,
		newLinks: [],
	};
}

function filterTwohopBranch(
	branch: TwoHopLinkBranch,
	matchedKeySet: Set<string>,
): TwoHopLinkBranch | null {
	const branchBaseKey = getTwohopBranchSearchBaseKey(branch);
	const matchedHop2 = branch.hop2.filter((link) =>
		matchedKeySet.has(
			getTwohopChildSearchKeyFromBranchBaseKey(branchBaseKey, link),
		),
	);
	if (matchedHop2.length === 0) {
		return null;
	}

	return {
		...branch,
		hop2: matchedHop2,
	};
}

function filterTagGroup(
	section: TagGroup,
	matchedKeySet: Set<string>,
): TagGroup | null {
	if (matchedKeySet.has(getTagGroupSearchKey(section))) {
		return section;
	}

	const matchedNotes = section.notes.filter((note) =>
		matchedKeySet.has(getTagNoteSearchKey(section, note)),
	);
	if (matchedNotes.length === 0) {
		return null;
	}

	return {
		...section,
		notes: matchedNotes,
	};
}

export function getOutgoingSearchKey(branch: TwoHopLinkBranch): string {
	return `${OUTGOING_SEARCH_PREFIX}${getBranchBaseKey(branch)}`;
}

export function getBacklinkSearchKey(link: TwoHopIndexedLink): string {
	return `${BACKLINK_SEARCH_PREFIX}${getBacklinkBaseKey(link)}`;
}

export function getMergedSearchKey(item: MergedLinkItem): string {
	return isBranchItem(item)
		? `${MERGED_SEARCH_PREFIX}${getBranchBaseKey(item)}`
		: `${MERGED_SEARCH_PREFIX}${getBacklinkBaseKey(item)}`;
}

export function getTwohopChildSearchKey(
	branch: TwoHopLinkBranch,
	link: TwoHopIndexedLink,
): string {
	return getTwohopChildSearchKeyFromBranchBaseKey(
		getTwohopBranchSearchBaseKey(branch),
		link,
	);
}

export function getTwohopBranchSearchBaseKey(branch: TwoHopLinkBranch): string {
	return getBranchBaseKey(branch);
}

export function getTwohopChildSearchKeyFromBranchBaseKey(
	branchBaseKey: string,
	link: TwoHopIndexedLink,
): string {
	return `${TWOHOP_CHILD_SEARCH_PREFIX}${branchBaseKey}${SEARCH_KEY_SEPARATOR}${getBacklinkBaseKey(link)}`;
}

export function getTagGroupSearchKey(section: TagGroup): string {
	return `${TAG_GROUP_SEARCH_PREFIX}${section.tag}`;
}

export function getTagNoteSearchKey(
	section: TagGroup,
	note: TaggedNote,
): string {
	return `${TAG_NOTE_SEARCH_PREFIX}${section.tag}${SEARCH_KEY_SEPARATOR}${getTagNoteBaseKey(note)}`;
}

function getBranchBaseKey(branch: TwoHopLinkBranch): string {
	return createBranchIdentitySignature(branch);
}

function getBacklinkBaseKey(link: TwoHopIndexedLink): string {
	return createBacklinkIdentitySignature(link);
}

function getTagNoteBaseKey(note: TaggedNote): string {
	return createLinkIdentitySignature(
		note.path,
		note.file.basename,
		"tag-note",
	);
}

function getBranchTargetFile(
	branch: TwoHopLinkBranch,
	resolveFile: (path: string) => TFile | null,
): TFile | null {
	if (branch.hop1.isUnresolved || !branch.hop1.path) {
		return null;
	}

	return resolveFile(branch.hop1.path);
}

function isBranchItem(item: MergedLinkItem): item is TwoHopLinkBranch {
	return "hop1" in item && "hop2" in item;
}
