import type { CachedMetadata, TFile } from "obsidian";
import type { SearchItemSnapshot, SearchMatchedItem } from "search/searchTypes";
import type { FileToLinktext } from "obsidian-integration/hostContracts";
import {
	createBacklinkIdentitySignature,
	createBranchIdentitySignature,
	createLinkIdentitySignature,
} from "cards/identity/keySignatures";
import type { DisplayData, MergedLinkItem } from "two-hop/display/displayDataBuilder";
import type { TagGroup, TwoHopLinkBranch } from "two-hop/model";
import type { TaggedNote, IndexedLink } from "indexing/model";
import { getFileCardTitleSearchText } from "cards/title/cardTitle";

const SEARCH_KEY_SEPARATOR = "\u001f";
const OUTGOING_SEARCH_PREFIX = "o";
const BACKLINK_SEARCH_PREFIX = "b";
const MERGED_SEARCH_PREFIX = "m";
const TWOHOP_CHILD_SEARCH_PREFIX = "h";
const TAG_GROUP_SEARCH_PREFIX = "g";
const TAG_NOTE_SEARCH_PREFIX = "n";

export interface TwohopIncrementalSearchFilter {
	/** Appends newly matched keys in search order and publishes a new outer snapshot. */
	append(matches: readonly SearchMatchedItem[]): DisplayData;
}

/** Immutable inputs derived together for one Two-hop search session. */
export interface TwoHopSearchSnapshot {
	/** Lower-cased title snapshots consumed by one search run. */
	readonly items: readonly SearchItemSnapshot[];
	/** Unique target files eligible for content search. */
	readonly searchableFiles: readonly TFile[];
	/** Creates a projector backed by the entries collected in the same traversal. */
	createIncrementalFilter(): TwohopIncrementalSearchFilter;
}

export interface TwohopSearchAdapterOptions {
	displayData: DisplayData;
	renderMode: TwohopSearchRenderMode;
	resolveFile: (path: string) => TFile | null;
	fileToLinktext: FileToLinktext;
	sourcePath: string;
	getMetadata: (file: TFile) => CachedMetadata | null;
	getSortedTwoHopItems: (items: readonly IndexedLink[]) => readonly IndexedLink[];
	getSortedTagGroupItems: (items: readonly TaggedNote[]) => readonly TaggedNote[];
	priorityFrontmatterKeyForTitle?: string;
}

export interface TwohopSearchRenderMode {
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
}

type IncrementalSearchEntry =
	| { readonly kind: "outgoing"; readonly branch: TwoHopLinkBranch }
	| { readonly kind: "backlink"; readonly link: IndexedLink }
	| { readonly kind: "merged"; readonly item: MergedLinkItem }
	| {
			readonly kind: "two-hop";
			readonly branch: TwoHopLinkBranch;
			readonly link: IndexedLink;
	  }
	| { readonly kind: "tag-group"; readonly section: TagGroup }
	| {
			readonly kind: "tag-note";
			readonly section: TagGroup;
			readonly note: TaggedNote;
	  };

function createTwohopIncrementalSearchFilter(
	displayData: DisplayData,
	entryByKey: ReadonlyMap<string, IncrementalSearchEntry>,
): TwohopIncrementalSearchFilter {
	const outgoing: TwoHopLinkBranch[] = [];
	const backlinks: IndexedLink[] = [];
	const mergedItems: MergedLinkItem[] = [];
	const twoHopBranches: TwoHopLinkBranch[] = [];
	const tagGroups: TagGroup[] = [];
	const outputBranchBySource = new Map<TwoHopLinkBranch, TwoHopLinkBranch>();
	const outputBranchIndexBySource = new Map<TwoHopLinkBranch, number>();
	const outputTagGroupBySource = new Map<TagGroup, TagGroup>();
	const outputTagGroupIndexBySource = new Map<TagGroup, number>();
	const completeTagGroups = new Set<TagGroup>();
	const appliedKeys = new Set<string>();

	const snapshot = (): DisplayData => ({
		...displayData,
		outgoing: [...outgoing],
		backlinks: [...backlinks],
		mergedItems: [...mergedItems],
		twoHopBranches: [...twoHopBranches],
		tagGroups: [...tagGroups],
		newLinks: [],
	});

	return {
		append(matches) {
			const mutableHop2ByBranch = new Map<TwoHopLinkBranch, IndexedLink[]>();
			const mutableNotesByTagGroup = new Map<TagGroup, TaggedNote[]>();
			for (const match of matches) {
				if (appliedKeys.has(match.key)) continue;
				appliedKeys.add(match.key);
				const entry = entryByKey.get(match.key);
				if (!entry) continue;
				switch (entry.kind) {
					case "outgoing":
						outgoing.push(entry.branch);
						break;
					case "backlink":
						backlinks.push(entry.link);
						break;
					case "merged":
						mergedItems.push(entry.item);
						break;
					case "two-hop": {
						let outputBranch = outputBranchBySource.get(entry.branch);
						let mutableHop2 = mutableHop2ByBranch.get(entry.branch);
						if (!outputBranch) {
							mutableHop2 = [];
							outputBranch = { ...entry.branch, hop2: mutableHop2 };
							outputBranchBySource.set(entry.branch, outputBranch);
							outputBranchIndexBySource.set(
								entry.branch,
								twoHopBranches.length,
							);
							twoHopBranches.push(outputBranch);
							mutableHop2ByBranch.set(entry.branch, mutableHop2);
						} else if (!mutableHop2) {
							mutableHop2 = [...outputBranch.hop2];
							outputBranch = {
								...outputBranch,
								hop2: mutableHop2,
							};
							const branchIndex = outputBranchIndexBySource.get(
								entry.branch,
							);
							if (branchIndex !== undefined) {
								twoHopBranches[branchIndex] = outputBranch;
							}
							outputBranchBySource.set(entry.branch, outputBranch);
							mutableHop2ByBranch.set(entry.branch, mutableHop2);
						}
						mutableHop2.push(entry.link);
						break;
					}
					case "tag-group": {
						const existing = outputTagGroupBySource.get(entry.section);
						if (existing) {
							const sectionIndex = outputTagGroupIndexBySource.get(
								entry.section,
							);
							if (sectionIndex !== undefined) {
								tagGroups[sectionIndex] = entry.section;
							}
							outputTagGroupBySource.set(entry.section, entry.section);
						} else {
							outputTagGroupBySource.set(entry.section, entry.section);
							outputTagGroupIndexBySource.set(
								entry.section,
								tagGroups.length,
							);
							tagGroups.push(entry.section);
						}
						completeTagGroups.add(entry.section);
						break;
					}
					case "tag-note": {
						if (completeTagGroups.has(entry.section)) break;
						let outputSection = outputTagGroupBySource.get(entry.section);
						let mutableNotes = mutableNotesByTagGroup.get(entry.section);
						if (!outputSection) {
							mutableNotes = [];
							outputSection = { ...entry.section, notes: mutableNotes };
							outputTagGroupBySource.set(entry.section, outputSection);
							outputTagGroupIndexBySource.set(
								entry.section,
								tagGroups.length,
							);
							tagGroups.push(outputSection);
							mutableNotesByTagGroup.set(entry.section, mutableNotes);
						} else if (!mutableNotes) {
							mutableNotes = [...outputSection.notes];
							outputSection = {
								...outputSection,
								notes: mutableNotes,
							};
							const sectionIndex = outputTagGroupIndexBySource.get(
								entry.section,
							);
							if (sectionIndex !== undefined) {
								tagGroups[sectionIndex] = outputSection;
							}
							outputTagGroupBySource.set(entry.section, outputSection);
							mutableNotesByTagGroup.set(entry.section, mutableNotes);
						}
						mutableNotes.push(entry.note);
						break;
					}
				}
			}
			return snapshot();
		},
	};
}

/** Builds search inputs and their incremental projection map in one traversal. */
export function buildTwoHopSearchSnapshot(
	options: TwohopSearchAdapterOptions,
): TwoHopSearchSnapshot {
	const snapshots: SearchItemSnapshot[] = [];
	const filesByPath = new Map<string, TFile>();
	const titleTextByFile = new Map<TFile, string>();
	const entryByKey = new Map<string, IncrementalSearchEntry>();
	const { displayData, resolveFile } = options;

	const addFile = (targetFile: TFile | null | undefined): void => {
		if (targetFile) filesByPath.set(targetFile.path, targetFile);
	};
	const getFileTitleSearchText = (file: TFile): string => {
		const cached = titleTextByFile.get(file);
		if (cached !== undefined) return cached;

		const titleText = getFileCardTitleSearchText(
			file,
			options.sourcePath,
			options.fileToLinktext,
			options.getMetadata,
			options.priorityFrontmatterKeyForTitle,
		);
		titleTextByFile.set(file, titleText);
		return titleText;
	};
	const appendSnapshot = (
		key: string,
		searchText: string,
		targetFile: TFile | null,
		entry: IncrementalSearchEntry,
	): void => {
		addFile(targetFile);
		entryByKey.set(key, entry);
		snapshots.push({
			key,
			searchText: searchText.toLowerCase(),
			targetFilePath: targetFile?.path ?? null,
		});
	};

	const getBranchTitleSearchText = (
		branch: TwoHopLinkBranch,
		targetFile: TFile | null,
	): string => {
		if (!targetFile) {
			return branch.hop1.rawText ?? branch.hop1.path ?? "";
		}

		const titleText = getFileTitleSearchText(targetFile);
		const branchText = branch.hop1.rawText ?? branch.hop1.path ?? "";
		return titleText && branchText
			? `${titleText} ${branchText}`
			: titleText || branchText;
	};

	if (options.renderMode.useMergedLinks) {
		for (const item of displayData.mergedItems) {
			const key = createMergedSearchKey(item);
			if (isBranchItem(item)) {
				const targetFile = getBranchTargetFile(item, resolveFile);
				appendSnapshot(
					key,
					getBranchTitleSearchText(item, targetFile),
					targetFile,
					{ kind: "merged", item },
				);
				continue;
			}

			appendSnapshot(
				key,
				getFileTitleSearchText(item.sourceFile),
				item.sourceFile,
				{ kind: "merged", item },
			);
		}
	} else {
		for (const branch of displayData.outgoing) {
			const targetFile = getBranchTargetFile(branch, resolveFile);
			appendSnapshot(
				createOutgoingSearchKey(branch),
				getBranchTitleSearchText(branch, targetFile),
				targetFile,
				{ kind: "outgoing", branch },
			);
		}

		for (const link of displayData.backlinks) {
			appendSnapshot(
				createBacklinkSearchKey(link),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile,
				{ kind: "backlink", link },
			);
		}
	}

	for (const branch of displayData.twoHopBranches) {
		const branchBaseKey = getBranchBaseKey(branch);
		for (const link of options.getSortedTwoHopItems(branch.hop2)) {
			appendSnapshot(
				createTwohopChildSearchKeyFromBranchBaseKey(branchBaseKey, link),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile,
				{ kind: "two-hop", branch, link },
			);
		}
	}

	if (options.renderMode.showTags) {
		for (const section of displayData.tagGroups) {
			appendSnapshot(getTagGroupSearchKey(section), `#${section.tag}`, null, {
				kind: "tag-group",
				section,
			});

			for (const note of options.getSortedTagGroupItems(section.notes)) {
				appendSnapshot(
					createTagNoteSearchKey(section, note),
					getFileTitleSearchText(note.file),
					note.file,
					{ kind: "tag-note", section, note },
				);
			}
		}
	}

	return {
		items: snapshots,
		searchableFiles: Array.from(filesByPath.values()),
		createIncrementalFilter: () =>
			createTwohopIncrementalSearchFilter(displayData, entryByKey),
	};
}

export function getOutgoingSearchKey(branch: TwoHopLinkBranch): string {
	return createOutgoingSearchKey(branch);
}

export function getBacklinkSearchKey(link: IndexedLink): string {
	return createBacklinkSearchKey(link);
}

export function getMergedSearchKey(item: MergedLinkItem): string {
	return createMergedSearchKey(item);
}

function createOutgoingSearchKey(branch: TwoHopLinkBranch): string {
	return `${OUTGOING_SEARCH_PREFIX}${getBranchBaseKey(branch)}`;
}

function createBacklinkSearchKey(link: IndexedLink): string {
	return `${BACKLINK_SEARCH_PREFIX}${getBacklinkBaseKey(link)}`;
}

function createMergedSearchKey(item: MergedLinkItem): string {
	return isBranchItem(item)
		? `${MERGED_SEARCH_PREFIX}${getBranchBaseKey(item)}`
		: `${MERGED_SEARCH_PREFIX}${getBacklinkBaseKey(item)}`;
}

export function getTwohopBranchSearchBaseKey(branch: TwoHopLinkBranch): string {
	return getBranchBaseKey(branch);
}

function createTwohopChildSearchKeyFromBranchBaseKey(
	branchBaseKey: string,
	link: IndexedLink,
): string {
	return createTwohopChildSearchKeyFromBaseKeys(
		branchBaseKey,
		getBacklinkBaseKey(link),
	);
}

export function createTwohopChildSearchKeyFromBaseKeys(
	branchBaseKey: string,
	backlinkBaseKey: string,
): string {
	return `${TWOHOP_CHILD_SEARCH_PREFIX}${branchBaseKey}${SEARCH_KEY_SEPARATOR}${backlinkBaseKey}`;
}

function getTagGroupSearchKey(section: TagGroup): string {
	return `${TAG_GROUP_SEARCH_PREFIX}${section.tag}`;
}

export function getTagNoteSearchKeyFromBaseKey(tag: string, baseKey: string): string {
	return createTagNoteSearchKeyFromBaseKey(tag, baseKey);
}

function createTagNoteSearchKey(section: TagGroup, note: TaggedNote): string {
	return createTagNoteSearchKeyFromBaseKey(section.tag, getTagNoteBaseKey(note));
}

function createTagNoteSearchKeyFromBaseKey(tag: string, baseKey: string): string {
	return `${TAG_NOTE_SEARCH_PREFIX}${tag}${SEARCH_KEY_SEPARATOR}${baseKey}`;
}

function getBranchBaseKey(branch: TwoHopLinkBranch): string {
	return createBranchIdentitySignature(branch);
}

function getBacklinkBaseKey(link: IndexedLink): string {
	return createBacklinkIdentitySignature(link);
}

function getTagNoteBaseKey(note: TaggedNote): string {
	return createLinkIdentitySignature(note.path, note.file.basename, "tag-note");
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
