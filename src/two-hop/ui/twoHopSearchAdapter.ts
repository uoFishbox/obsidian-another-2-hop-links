import type { CachedMetadata, TFile } from "obsidian";
import type {
	SearchWorkerItemSnapshot,
	SearchWorkerMatchedItem,
} from "search/searchWorkerTypes";
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

interface SearchKeyCache {
	branchBaseKeys: WeakMap<TwoHopLinkBranch, string>;
	backlinkBaseKeys: WeakMap<IndexedLink, string>;
	tagNoteBaseKeys: WeakMap<TaggedNote, string>;
}

export interface TwohopSearchAdapter {
	/** Builds all inputs needed by a search session in one display-data traversal. */
	buildSnapshot(options: TwohopSearchAdapterOptions): TwoHopSearchSnapshot;
	filterDisplayData(
		displayData: DisplayData,
		query: string,
		matchesByKey: Map<string, SearchWorkerMatchedItem> | null,
		renderMode: TwohopSearchRenderMode,
	): DisplayData;
}

/** Immutable inputs derived together for one Two-hop search session. */
export interface TwoHopSearchSnapshot {
	/** Lower-cased title snapshots sent to the search Worker. */
	readonly workerItems: readonly SearchWorkerItemSnapshot[];
	/** Unique target files eligible for content search. */
	readonly searchableFiles: readonly TFile[];
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
	renderMode: TwohopSearchRenderMode;
	resolveFile: (path: string) => TFile | null;
	fileToLinktext: FileToLinktext;
	sourcePath: string;
	getMetadata: (file: TFile) => CachedMetadata | null;
	priorityFrontmatterKeyForTitle?: string;
}

export interface TwohopSearchRenderMode {
	readonly useMergedLinks: boolean;
	readonly showTags: boolean;
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
		buildSnapshot(options) {
			return buildTwoHopSearchSnapshotWithCache(
				options,
				getSearchKeyCache(options.displayData),
			);
		},
		filterDisplayData(displayData, query, matchesByKey, renderMode) {
			return filterTwohopDisplayDataWithCache(
				displayData,
				query,
				matchesByKey,
				renderMode,
				getSearchKeyCache(displayData),
			);
		},
	};
}

function buildTwoHopSearchSnapshotWithCache(
	options: TwohopSearchAdapterOptions,
	searchKeyCache?: SearchKeyCache,
): TwoHopSearchSnapshot {
	const snapshots: SearchWorkerItemSnapshot[] = [];
	const filesByPath = new Map<string, TFile>();
	const titleTextByFile = new Map<TFile, string>();
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
	): void => {
		addFile(targetFile);
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
			if (isBranchItem(item)) {
				const targetFile = getBranchTargetFile(item, resolveFile);
				appendSnapshot(
					createMergedSearchKey(item, searchKeyCache),
					getBranchTitleSearchText(item, targetFile),
					targetFile,
				);
				continue;
			}

			appendSnapshot(
				createMergedSearchKey(item, searchKeyCache),
				getFileTitleSearchText(item.sourceFile),
				item.sourceFile,
			);
		}
	} else {
		for (const branch of displayData.outgoing) {
			const targetFile = getBranchTargetFile(branch, resolveFile);
			appendSnapshot(
				createOutgoingSearchKey(branch, searchKeyCache),
				getBranchTitleSearchText(branch, targetFile),
				targetFile,
			);
		}

		for (const link of displayData.backlinks) {
			appendSnapshot(
				createBacklinkSearchKey(link, searchKeyCache),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile,
			);
		}
	}

	for (const branch of displayData.twoHopBranches) {
		const branchBaseKey = getBranchBaseKey(branch, searchKeyCache);
		for (const link of branch.hop2) {
			appendSnapshot(
				createTwohopChildSearchKeyFromBranchBaseKey(
					branchBaseKey,
					link,
					searchKeyCache,
				),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile,
			);
		}
	}

	if (options.renderMode.showTags) {
		for (const section of displayData.tagGroups) {
			appendSnapshot(getTagGroupSearchKey(section), `#${section.tag}`, null);

			for (const note of section.notes) {
				appendSnapshot(
					createTagNoteSearchKey(section, note, searchKeyCache),
					getFileTitleSearchText(note.file),
					note.file,
				);
			}
		}
	}

	return {
		workerItems: snapshots,
		searchableFiles: Array.from(filesByPath.values()),
	};
}

function filterTwohopDisplayDataWithCache(
	displayData: DisplayData,
	query: string,
	matchesByKey: Map<string, SearchWorkerMatchedItem> | null,
	renderMode: TwohopSearchRenderMode,
	searchKeyCache?: SearchKeyCache,
): DisplayData {
	if (!query) {
		return displayData;
	}

	if (!matchesByKey) {
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

	const outgoing = renderMode.useMergedLinks
		? []
		: filterWithReferenceReuse(displayData.outgoing, (branch) =>
				matchesByKey.has(createOutgoingSearchKey(branch, searchKeyCache)),
			);
	const backlinks = renderMode.useMergedLinks
		? []
		: filterWithReferenceReuse(displayData.backlinks, (link) =>
				matchesByKey.has(createBacklinkSearchKey(link, searchKeyCache)),
			);
	const mergedItems = renderMode.useMergedLinks
		? filterWithReferenceReuse(displayData.mergedItems, (item) =>
				matchesByKey.has(createMergedSearchKey(item, searchKeyCache)),
			)
		: [];

	const twoHopBranches: TwoHopLinkBranch[] = [];
	for (const branch of displayData.twoHopBranches) {
		const filteredBranch = filterTwohopBranch(branch, matchesByKey, searchKeyCache);
		if (filteredBranch) {
			twoHopBranches.push(filteredBranch);
		}
	}
	const tagGroups: TagGroup[] = [];
	if (renderMode.showTags) {
		for (const section of displayData.tagGroups) {
			const filteredSection = filterTagGroup(
				section,
				matchesByKey,
				searchKeyCache,
			);
			if (filteredSection) {
				tagGroups.push(filteredSection);
			}
		}
	}

	return {
		...displayData,
		outgoing,
		backlinks,
		mergedItems,
		twoHopBranches,
		tagGroups,
		newLinks: [],
	};
}

function filterTwohopBranch(
	branch: TwoHopLinkBranch,
	matchesByKey: Map<string, SearchWorkerMatchedItem>,
	searchKeyCache?: SearchKeyCache,
): TwoHopLinkBranch | null {
	const branchBaseKey = getBranchBaseKey(branch, searchKeyCache);
	const matchedHop2 = branch.hop2.filter((link) =>
		matchesByKey.has(
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
	matchesByKey: Map<string, SearchWorkerMatchedItem>,
	searchKeyCache?: SearchKeyCache,
): TagGroup | null {
	if (matchesByKey.has(getTagGroupSearchKey(section))) {
		return section;
	}

	const matchedNotes = section.notes.filter((note) =>
		matchesByKey.has(createTagNoteSearchKey(section, note, searchKeyCache)),
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

export function getBacklinkSearchKey(link: IndexedLink): string {
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
	link: IndexedLink,
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

export function getTwohopBranchSearchBaseKey(branch: TwoHopLinkBranch): string {
	return getBranchBaseKey(branch);
}

function createTwohopChildSearchKeyFromBranchBaseKey(
	branchBaseKey: string,
	link: IndexedLink,
	searchKeyCache?: SearchKeyCache,
): string {
	return createTwohopChildSearchKeyFromBaseKeys(
		branchBaseKey,
		getBacklinkBaseKey(link, searchKeyCache),
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

function createTagNoteSearchKey(
	section: TagGroup,
	note: TaggedNote,
	searchKeyCache?: SearchKeyCache,
): string {
	return createTagNoteSearchKeyFromBaseKey(
		section.tag,
		getTagNoteBaseKey(note, searchKeyCache),
	);
}

function createTagNoteSearchKeyFromBaseKey(tag: string, baseKey: string): string {
	return `${TAG_NOTE_SEARCH_PREFIX}${tag}${SEARCH_KEY_SEPARATOR}${baseKey}`;
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
	link: IndexedLink,
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

function getTagNoteBaseKey(note: TaggedNote, searchKeyCache?: SearchKeyCache): string {
	const cached = searchKeyCache?.tagNoteBaseKeys.get(note);
	if (cached !== undefined) {
		return cached;
	}

	const key = createLinkIdentitySignature(note.path, note.file.basename, "tag-note");
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
