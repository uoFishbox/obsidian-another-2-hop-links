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
} from "features/two-hop/application/displayDataBuilder";
import type {
	TagGroup,
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkBranch,
} from "types/domain";
import { getFileCardTitleSearchText } from "core/frontmatterCardTitle";
import { generateBranchKey } from "features/preview/text-processing/textUtils";
import { createCompactSectionId } from "ui/components/common/listPagination";

const SEARCH_KEY_SEPARATOR = "\u001f";
const OUTGOING_SEARCH_PREFIX = "o";
const BACKLINK_SEARCH_PREFIX = "b";
const MERGED_SEARCH_PREFIX = "m";
const TWOHOP_CHILD_SEARCH_PREFIX = "h";
const TAG_GROUP_SEARCH_PREFIX = "g";
const TAG_NOTE_SEARCH_PREFIX = "n";
const OUTGOING_SECTION_ID = "outgoing";
const BACKLINK_SECTION_ID = "backlinks";
const MERGED_SECTION_ID = "merged";

interface SearchKeyCache {
	branchBaseKeys: WeakMap<TwoHopLinkBranch, string>;
	backlinkBaseKeys: WeakMap<TwoHopIndexedLink, string>;
	tagNoteBaseKeys: WeakMap<TaggedNote, string>;
}

export interface TwohopSearchAdapter {
	/** Builds all inputs needed by a search session in one display-data traversal. */
	buildSnapshot(options: TwohopSearchAdapterOptions): TwoHopSearchSnapshot;
	buildDataset(options: TwohopSearchAdapterOptions): SearchWorkerItemSnapshot[];
	filterDisplayData(
		displayData: DisplayData,
		query: string,
		matchedKeySet: Set<string> | null,
		renderMode: TwohopSearchRenderMode,
	): DisplayData;
}

/** Identifies the unfiltered display-data position represented by a search key. */
export interface SearchLocation {
	readonly sectionId: string;
	/** The index in the section's unfiltered source array. Header matches use -1. */
	readonly sourceIndex: number;
}

/** Immutable inputs derived together for one Two-hop search session. */
export interface TwoHopSearchSnapshot {
	/** Lower-cased title snapshots sent to the search Worker. */
	readonly workerItems: readonly SearchWorkerItemSnapshot[];
	/** Unique target files eligible for content search. */
	readonly searchableFiles: readonly TFile[];
	/** Display-data position for every Worker item key. */
	readonly locationByKey: ReadonlyMap<string, SearchLocation>;
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
		buildDataset(options) {
			return Array.from(
				buildTwoHopSearchSnapshotWithCache(
					options,
					getSearchKeyCache(options.displayData),
				).workerItems,
			);
		},
		filterDisplayData(displayData, query, matchedKeySet, renderMode) {
			return filterTwohopDisplayDataWithCache(
				displayData,
				query,
				matchedKeySet,
				renderMode,
				getSearchKeyCache(displayData),
			);
		},
	};
}

export function collectTwohopSearchableFiles(
	options: TwohopSearchAdapterOptions,
): TFile[] {
	return Array.from(buildTwoHopSearchSnapshotWithCache(options).searchableFiles);
}

function buildTwoHopSearchSnapshotWithCache(
	options: TwohopSearchAdapterOptions,
	searchKeyCache?: SearchKeyCache,
): TwoHopSearchSnapshot {
	const snapshots: SearchWorkerItemSnapshot[] = [];
	const filesByPath = new Map<string, TFile>();
	const locationByKey = new Map<string, SearchLocation>();
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
		location: SearchLocation,
	): void => {
		addFile(targetFile);
		snapshots.push(
			buildSearchWorkerItemSnapshot(key, searchText, targetFile?.path ?? null),
		);
		locationByKey.set(key, location);
	};

	const getBranchTitleSearchText = (
		branch: TwoHopLinkBranch,
		targetFile: TFile | null,
	): string => {
		if (!targetFile) {
			return getBranchSearchText(branch.hop1);
		}

		const titleText = getFileTitleSearchText(targetFile);
		const branchText = getBranchSearchText(branch.hop1);
		return titleText && branchText
			? `${titleText} ${branchText}`
			: titleText || branchText;
	};

	if (options.renderMode.useMergedLinks) {
		for (let index = 0; index < displayData.mergedItems.length; index += 1) {
			const item = displayData.mergedItems[index];
			if (isBranchItem(item)) {
				const targetFile = getBranchTargetFile(item, resolveFile);
				appendSnapshot(
					createMergedSearchKey(item, searchKeyCache),
					getBranchTitleSearchText(item, targetFile),
					targetFile,
					{ sectionId: MERGED_SECTION_ID, sourceIndex: index },
				);
				continue;
			}

			appendSnapshot(
				createMergedSearchKey(item, searchKeyCache),
				getFileTitleSearchText(item.sourceFile),
				item.sourceFile,
				{ sectionId: MERGED_SECTION_ID, sourceIndex: index },
			);
		}
	} else {
		for (let index = 0; index < displayData.outgoing.length; index += 1) {
			const branch = displayData.outgoing[index];
			const targetFile = getBranchTargetFile(branch, resolveFile);
			appendSnapshot(
				createOutgoingSearchKey(branch, searchKeyCache),
				getBranchTitleSearchText(branch, targetFile),
				targetFile,
				{ sectionId: OUTGOING_SECTION_ID, sourceIndex: index },
			);
		}

		for (let index = 0; index < displayData.backlinks.length; index += 1) {
			const link = displayData.backlinks[index];
			appendSnapshot(
				createBacklinkSearchKey(link, searchKeyCache),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile,
				{ sectionId: BACKLINK_SECTION_ID, sourceIndex: index },
			);
		}
	}

	for (const branch of displayData.twoHopBranches) {
		const targetFile = getBranchTargetFile(branch, resolveFile);
		addFile(targetFile);
		const branchBaseKey = getBranchBaseKey(branch, searchKeyCache);
		const sectionId = createCompactSectionId("twohop", generateBranchKey(branch));
		for (let index = 0; index < branch.hop2.length; index += 1) {
			const link = branch.hop2[index];
			appendSnapshot(
				createTwohopChildSearchKeyFromBranchBaseKey(
					branchBaseKey,
					link,
					searchKeyCache,
				),
				getFileTitleSearchText(link.sourceFile),
				link.sourceFile,
				{ sectionId, sourceIndex: index },
			);
		}
	}

	if (options.renderMode.showTags) {
		for (const section of displayData.tagGroups) {
			const sectionId = `tags-${section.tag}`;
			appendSnapshot(
				getTagGroupSearchKey(section),
				getTagGroupSearchText(section.tag),
				null,
				{ sectionId, sourceIndex: -1 },
			);

			for (let index = 0; index < section.notes.length; index += 1) {
				const note = section.notes[index];
				appendSnapshot(
					createTagNoteSearchKey(section, note, searchKeyCache),
					getFileTitleSearchText(note.file),
					note.file,
					{ sectionId, sourceIndex: index },
				);
			}
		}
	}

	return {
		workerItems: snapshots,
		searchableFiles: Array.from(filesByPath.values()),
		locationByKey,
	};
}

function filterTwohopDisplayDataWithCache(
	displayData: DisplayData,
	query: string,
	matchedKeySet: Set<string> | null,
	renderMode: TwohopSearchRenderMode,
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

	const outgoing = renderMode.useMergedLinks
		? []
		: filterWithReferenceReuse(displayData.outgoing, (branch) =>
				matchedKeySet.has(createOutgoingSearchKey(branch, searchKeyCache)),
			);
	const backlinks = renderMode.useMergedLinks
		? []
		: filterWithReferenceReuse(displayData.backlinks, (link) =>
				matchedKeySet.has(createBacklinkSearchKey(link, searchKeyCache)),
			);
	const mergedItems = renderMode.useMergedLinks
		? filterWithReferenceReuse(displayData.mergedItems, (item) =>
				matchedKeySet.has(createMergedSearchKey(item, searchKeyCache)),
			)
		: [];

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
	if (renderMode.showTags) {
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
		matchedKeySet.has(createTagNoteSearchKey(section, note, searchKeyCache)),
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

export function getTwohopBranchSearchBaseKey(branch: TwoHopLinkBranch): string {
	return getBranchBaseKey(branch);
}

function createTwohopChildSearchKeyFromBranchBaseKey(
	branchBaseKey: string,
	link: TwoHopIndexedLink,
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
