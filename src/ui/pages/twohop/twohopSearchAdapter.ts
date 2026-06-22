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

interface SearchKeyCache {
	branchBaseKeys: WeakMap<TwoHopLinkBranch, string>;
	backlinkBaseKeys: WeakMap<TwoHopIndexedLink, string>;
	tagNoteBaseKeys: WeakMap<TaggedNote, string>;
}

export interface TwohopSearchAdapter {
	buildDataset(
		options: TwohopSearchAdapterOptions,
	): SearchWorkerItemSnapshot[];
	filterDisplayData(
		displayData: DisplayData,
		query: string,
		matchedKeySet: Set<string> | null,
	): DisplayData;
}

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

/**
 * Creates a page-scoped search adapter that reuses identity signatures while
 * the same DisplayData snapshot is being filtered.
 */
export function createTwohopSearchAdapter(): TwohopSearchAdapter {
	let currentDisplayData: DisplayData | null = null;
	let searchKeyCache = createSearchKeyCache();

	const getSearchKeyCache = (displayData: DisplayData): SearchKeyCache => {
		if (displayData === currentDisplayData) {
			return searchKeyCache;
		}

		currentDisplayData = displayData;
		searchKeyCache = createSearchKeyCache();
		return searchKeyCache;
	};

	return {
		buildDataset(options) {
			return buildTwohopSearchDatasetWithCache(
				options,
				getSearchKeyCache(options.displayData),
			);
		},
		filterDisplayData(displayData, query, matchedKeySet) {
			return filterTwohopDisplayDataWithCache(
				displayData,
				query,
				matchedKeySet,
				getSearchKeyCache(displayData),
			);
		},
	};
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
	return buildTwohopSearchDatasetWithCache(options);
}

function buildTwohopSearchDatasetWithCache(
	options: TwohopSearchAdapterOptions,
	searchKeyCache?: SearchKeyCache,
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
				createOutgoingSearchKey(branch, searchKeyCache),
				getBranchTitleSearchText(branch),
				getBranchTargetFile(branch, resolveFile)?.path ?? null,
			),
		);
	}

	for (const link of displayData.backlinks) {
		snapshots.push(
			buildSearchWorkerItemSnapshot(
				createBacklinkSearchKey(link, searchKeyCache),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile.path,
			),
		);
	}

	for (const item of displayData.mergedItems) {
		if (isBranchItem(item)) {
			snapshots.push(
				buildSearchWorkerItemSnapshot(
					createMergedSearchKey(item, searchKeyCache),
					getBranchTitleSearchText(item),
					getBranchTargetFile(item, resolveFile)?.path ?? null,
				),
			);
			continue;
		}

		snapshots.push(
			buildSearchWorkerItemSnapshot(
				createMergedSearchKey(item, searchKeyCache),
				getFileTitleSearchText(item.sourceFile),
				item.sourceFile.path,
			),
		);
	}

	for (const branch of displayData.twoHopBranches) {
		const branchBaseKey = getBranchBaseKey(branch, searchKeyCache);
		for (const link of branch.hop2) {
			snapshots.push(
				buildSearchWorkerItemSnapshot(
					createTwohopChildSearchKeyFromBranchBaseKey(
						branchBaseKey,
						link,
						searchKeyCache,
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
					createTagNoteSearchKey(
						section,
						note,
						searchKeyCache,
					),
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
	return filterTwohopDisplayDataWithCache(
		displayData,
		query,
		matchedKeySet,
	);
}

function filterTwohopDisplayDataWithCache(
	displayData: DisplayData,
	query: string,
	matchedKeySet: Set<string> | null,
	searchKeyCache?: SearchKeyCache,
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
		const filteredBranch = filterTwohopBranch(
			branch,
			matchedKeySet,
			searchKeyCache,
		);
		if (filteredBranch) {
			twoHopBranches.push(filteredBranch);
		}
	}
	const tagGroups: TagGroup[] = [];
	for (const section of displayData.tagGroups) {
		const filteredSection = filterTagGroup(
			section,
			matchedKeySet,
			searchKeyCache,
		);
		if (filteredSection) {
			tagGroups.push(filteredSection);
		}
	}

	return {
		...displayData,
		outgoing: filterWithReferenceReuse(displayData.outgoing, (branch) =>
			matchedKeySet.has(
				createOutgoingSearchKey(branch, searchKeyCache),
			),
		),
		backlinks: filterWithReferenceReuse(displayData.backlinks, (link) =>
			matchedKeySet.has(
				createBacklinkSearchKey(link, searchKeyCache),
			),
		),
		mergedItems: filterWithReferenceReuse(displayData.mergedItems, (item) =>
			matchedKeySet.has(createMergedSearchKey(item, searchKeyCache)),
		),
		twoHopBranches,
		tagGroups,
		newLinks: [],
	};
}

function filterTwohopBranch(
	branch: TwoHopLinkBranch,
	matchedKeySet: Set<string>,
	searchKeyCache?: SearchKeyCache,
): TwoHopLinkBranch | null {
	const branchBaseKey = getBranchBaseKey(branch, searchKeyCache);
	const matchedHop2 = branch.hop2.filter((link) =>
		matchedKeySet.has(
			createTwohopChildSearchKeyFromBranchBaseKey(
				branchBaseKey,
				link,
				searchKeyCache,
			),
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
	searchKeyCache?: SearchKeyCache,
): TagGroup | null {
	if (matchedKeySet.has(getTagGroupSearchKey(section))) {
		return section;
	}

	const matchedNotes = section.notes.filter((note) =>
		matchedKeySet.has(
			createTagNoteSearchKey(section, note, searchKeyCache),
		),
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
	return createOutgoingSearchKey(branch);
}

export function getBacklinkSearchKey(link: TwoHopIndexedLink): string {
	return createBacklinkSearchKey(link);
}

export function getMergedSearchKey(item: MergedLinkItem): string {
	return createMergedSearchKey(item);
}

function createOutgoingSearchKey(
	branch: TwoHopLinkBranch,
	searchKeyCache?: SearchKeyCache,
): string {
	return `${OUTGOING_SEARCH_PREFIX}${getBranchBaseKey(branch, searchKeyCache)}`;
}

function createBacklinkSearchKey(
	link: TwoHopIndexedLink,
	searchKeyCache?: SearchKeyCache,
): string {
	return `${BACKLINK_SEARCH_PREFIX}${getBacklinkBaseKey(link, searchKeyCache)}`;
}

function createMergedSearchKey(
	item: MergedLinkItem,
	searchKeyCache?: SearchKeyCache,
): string {
	return isBranchItem(item)
		? `${MERGED_SEARCH_PREFIX}${getBranchBaseKey(item, searchKeyCache)}`
		: `${MERGED_SEARCH_PREFIX}${getBacklinkBaseKey(item, searchKeyCache)}`;
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
	return createTwohopChildSearchKeyFromBranchBaseKey(branchBaseKey, link);
}

function createTwohopChildSearchKeyFromBranchBaseKey(
	branchBaseKey: string,
	link: TwoHopIndexedLink,
	searchKeyCache?: SearchKeyCache,
): string {
	return `${TWOHOP_CHILD_SEARCH_PREFIX}${branchBaseKey}${SEARCH_KEY_SEPARATOR}${getBacklinkBaseKey(link, searchKeyCache)}`;
}

export function getTagGroupSearchKey(section: TagGroup): string {
	return `${TAG_GROUP_SEARCH_PREFIX}${section.tag}`;
}

export function getTagNoteSearchKey(
	section: TagGroup,
	note: TaggedNote,
): string {
	return createTagNoteSearchKey(section, note);
}

function createTagNoteSearchKey(
	section: TagGroup,
	note: TaggedNote,
	searchKeyCache?: SearchKeyCache,
): string {
	return `${TAG_NOTE_SEARCH_PREFIX}${section.tag}${SEARCH_KEY_SEPARATOR}${getTagNoteBaseKey(note, searchKeyCache)}`;
}

function getBranchBaseKey(
	branch: TwoHopLinkBranch,
	searchKeyCache?: SearchKeyCache,
): string {
	const cached = searchKeyCache?.branchBaseKeys.get(branch);
	if (cached !== undefined) {
		return cached;
	}

	const key = createBranchIdentitySignature(branch);
	searchKeyCache?.branchBaseKeys.set(branch, key);
	return key;
}

function getBacklinkBaseKey(
	link: TwoHopIndexedLink,
	searchKeyCache?: SearchKeyCache,
): string {
	const cached = searchKeyCache?.backlinkBaseKeys.get(link);
	if (cached !== undefined) {
		return cached;
	}

	const key = createBacklinkIdentitySignature(link);
	searchKeyCache?.backlinkBaseKeys.set(link, key);
	return key;
}

function getTagNoteBaseKey(
	note: TaggedNote,
	searchKeyCache?: SearchKeyCache,
): string {
	const cached = searchKeyCache?.tagNoteBaseKeys.get(note);
	if (cached !== undefined) {
		return cached;
	}

	const key = createLinkIdentitySignature(
		note.path,
		note.file.basename,
		"tag-note",
	);
	searchKeyCache?.tagNoteBaseKeys.set(note, key);
	return key;
}

function createSearchKeyCache(): SearchKeyCache {
	return {
		branchBaseKeys: new WeakMap(),
		backlinkBaseKeys: new WeakMap(),
		tagNoteBaseKeys: new WeakMap(),
	};
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
