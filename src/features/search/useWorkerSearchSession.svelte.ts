import { onDestroy } from "svelte";
import type { App, Pos, TFile } from "obsidian";
import { createSearchWorkerClient } from "./searchWorkerClient";
import {
	useFileContentIndex,
	type FileContentIndexResult,
} from "./useFileContentIndex.svelte";
import type { SearchContentIndexEntry } from "./useFileContentIndex.svelte";
import type {
	SearchWorkerMatchScope,
	SearchWorkerItemSnapshot,
	SearchWorkerMatchedItem,
	SearchWorkerFileContentSnapshot,
} from "./searchWorkerTypes";
import { filterSearchWorkerDatasetWithMatchDetailsTimeSliced } from "./searchWorkerFilter";

const EMPTY_SEARCH_WORKER_ITEMS: readonly SearchWorkerItemSnapshot[] = [];

interface WorkerFileContentSyncState {
	sessionEnabled: boolean;
	matchScope: SearchWorkerMatchScope;
	query: string;
	partialSyncEnabled: boolean;
	contentIndexIsLoading: boolean;
}

function shouldSyncWorkerFileContents(state: WorkerFileContentSyncState): boolean {
	if (
		!state.sessionEnabled ||
		state.matchScope !== "title-and-content" ||
		!state.query
	) {
		return false;
	}

	return !state.contentIndexIsLoading || state.partialSyncEnabled;
}

interface SearchWorkerFileContentDiff {
	changed: boolean;
	upserts: SearchWorkerFileContentSnapshot[];
	removals: string[];
	nextEntriesByPath: Map<string, Readonly<SearchContentIndexEntry>> | null;
}

type FileContentEntryVisitor = (
	visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
) => void;

function diffSearchWorkerFileContentsFromVisitor(
	visitCurrentEntries: FileContentEntryVisitor,
	previousEntriesByPath: ReadonlyMap<string, Readonly<SearchContentIndexEntry>>,
	includeContents: boolean,
): SearchWorkerFileContentDiff {
	const seenPaths = new Set<string>();
	const upserts: SearchWorkerFileContentSnapshot[] = [];
	const removals: string[] = [];
	let nextEntriesByPath: Map<string, Readonly<SearchContentIndexEntry>> | null = null;
	const ensureNextEntriesByPath = (): Map<
		string,
		Readonly<SearchContentIndexEntry>
	> => {
		nextEntriesByPath ??= new Map(previousEntriesByPath);
		return nextEntriesByPath;
	};

	visitCurrentEntries((path, entry) => {
		seenPaths.add(path);
		const previousEntry = previousEntriesByPath.get(path);
		if (
			!includeContents ||
			(previousEntry?.mtime === entry.mtime &&
				previousEntry?.content === entry.content)
		) {
			return;
		}

		upserts.push({ path, content: entry.content });
		ensureNextEntriesByPath().set(path, entry);
	});

	for (const path of previousEntriesByPath.keys()) {
		if (seenPaths.has(path)) continue;
		removals.push(path);
		ensureNextEntriesByPath().delete(path);
	}

	if (upserts.length === 0 && removals.length === 0) {
		return { changed: false, upserts, removals, nextEntriesByPath: null };
	}

	return {
		changed: true,
		upserts,
		removals,
		nextEntriesByPath: nextEntriesByPath ?? new Map(),
	};
}

export interface UseWorkerSearchSessionOptions {
	app: App;
	query: () => string;
	enabled?: boolean | (() => boolean);
	contentIndexEnabled?: boolean | (() => boolean);
	matchScope?: SearchWorkerMatchScope | (() => SearchWorkerMatchScope);
	getSearchableFiles: () => readonly TFile[];
	buildDataset: () => readonly SearchWorkerItemSnapshot[];
}

export interface WorkerSearchSessionResult {
	readonly matchesByKey: Map<string, SearchWorkerMatchedItem> | null;
	readonly matchedQuery: string;
	readonly matchedScope: SearchWorkerMatchScope;
	readonly isFiltering: boolean;
	readonly isLoading: boolean;
	readonly contentIndex: FileContentIndexResult;
	getFirstMatchPosition(
		query: string,
		targetFile: TFile | null | undefined,
	): Pos | undefined;
}

export function useWorkerSearchSession(
	options: UseWorkerSearchSessionOptions,
): WorkerSearchSessionResult {
	const {
		app,
		query,
		enabled = true,
		contentIndexEnabled = enabled,
		matchScope = "title-and-content",
		getSearchableFiles,
		buildDataset,
	} = options;
	const isEnabled = (): boolean =>
		typeof enabled === "function" ? enabled() : enabled;
	const isContentIndexEnabled = (): boolean =>
		typeof contentIndexEnabled === "function"
			? contentIndexEnabled()
			: contentIndexEnabled;
	const getMatchScope = (): SearchWorkerMatchScope =>
		typeof matchScope === "function" ? matchScope() : matchScope;
	let sessionEnabled = $derived(isEnabled());
	let currentMatchScope = $derived(getMatchScope());
	let partialSyncEnabled = $state(false);
	const contentIndex = useFileContentIndex(app, getSearchableFiles, {
		enabled: () =>
			isContentIndexEnabled() && currentMatchScope === "title-and-content",
	});
	const buildWorkerDataset = (): readonly SearchWorkerItemSnapshot[] => {
		if (!sessionEnabled) {
			return EMPTY_SEARCH_WORKER_ITEMS;
		}

		return buildDataset();
	};

	let workerDataset = $derived.by(buildWorkerDataset);
	let matchesByKey = $state<Map<string, SearchWorkerMatchedItem> | null>(null);
	let matchedQuery = $state("");
	let matchedScope = $state<SearchWorkerMatchScope>("title-only");
	let isWorkerFiltering = $state(false);
	let syncedDatasetVersion = $state(0);
	let requestSerial = 0;
	let activeRequestQuery = "";
	let activeRequestScope: SearchWorkerMatchScope = "title-only";
	let fallbackFilterSerial = 0;
	let workerUnavailable = $state(false);
	let lastIssuedSearchSignature = "";
	let lastSyncedWorkerDataset: readonly SearchWorkerItemSnapshot[] | null = null;
	let lastSyncedFileContentsByPath = new Map<
		string,
		Readonly<SearchContentIndexEntry>
	>();

	const searchWorkerClient = createSearchWorkerClient((message) => {
		if (message.type === "error") {
			workerUnavailable = true;
			lastIssuedSearchSignature = "";
			isWorkerFiltering = false;
			const normalizedQuery = query();
			if (sessionEnabled && normalizedQuery) {
				issueSearchFilter(normalizedQuery);
			}
			return;
		}

		if (message.datasetVersion !== syncedDatasetVersion) {
			return;
		}

		if (message.requestId !== requestSerial) {
			return;
		}

		const nextMatchesByKey = new Map<string, SearchWorkerMatchedItem>();
		for (const item of message.matchedItems) {
			nextMatchesByKey.set(item.key, item);
		}
		matchesByKey = nextMatchesByKey;
		matchedQuery = activeRequestQuery;
		matchedScope = activeRequestScope;
		isWorkerFiltering = false;
	});

	const cancelFallbackSearch = (): void => {
		fallbackFilterSerial += 1;
	};

	const buildFallbackContentByPath = (): Map<string, string> => {
		const contentByPath = new Map<string, string>();
		contentIndex.forEachEntry((path, entry) => {
			contentByPath.set(path, entry.content);
		});
		return contentByPath;
	};

	const issueFallbackSearch = (
		normalizedQuery: string,
		requestId: number,
		requestScope: SearchWorkerMatchScope,
	): void => {
		const fallbackSerial = ++fallbackFilterSerial;
		const datasetVersion = syncedDatasetVersion;
		const matchedItems: SearchWorkerMatchedItem[] = [];
		isWorkerFiltering = true;

		void filterSearchWorkerDatasetWithMatchDetailsTimeSliced({
			dataset: {
				datasetVersion,
				items: workerDataset,
				fileContents: [],
			},
			query: normalizedQuery,
			matchScope: requestScope,
			cachedContentByPath: buildFallbackContentByPath(),
			onMatch: (item) => matchedItems.push(item),
			isCancelled: () =>
				fallbackSerial !== fallbackFilterSerial ||
				requestId !== requestSerial ||
				datasetVersion !== syncedDatasetVersion,
		}).then(() => {
			if (
				fallbackSerial !== fallbackFilterSerial ||
				requestId !== requestSerial ||
				datasetVersion !== syncedDatasetVersion
			) {
				return;
			}

			const nextMatchesByKey = new Map<string, SearchWorkerMatchedItem>();
			for (const item of matchedItems) {
				nextMatchesByKey.set(item.key, item);
			}
			matchesByKey = nextMatchesByKey;
			matchedQuery = normalizedQuery;
			matchedScope = requestScope;
			isWorkerFiltering = false;
		});
	};

	onDestroy(() => {
		cancelFallbackSearch();
		searchWorkerClient.terminate();
	});

	let isSearchLoading = $derived(
		sessionEnabled &&
			!!query() &&
			((currentMatchScope === "title-and-content" && contentIndex.isLoading()) ||
				isWorkerFiltering),
	);

	$effect(() => {
		const shouldWaitForPartialSync =
			sessionEnabled &&
			isContentIndexEnabled() &&
			currentMatchScope === "title-and-content" &&
			!!query() &&
			contentIndex.isLoading();

		partialSyncEnabled = false;
		if (!shouldWaitForPartialSync) {
			return;
		}

		const timer = window.setTimeout(() => {
			partialSyncEnabled = true;
		}, 400);

		return () => {
			window.clearTimeout(timer);
		};
	});

	$effect(() => {
		const contentSyncCanTrackPaths =
			isContentIndexEnabled() && currentMatchScope === "title-and-content";

		if (!sessionEnabled && !contentSyncCanTrackPaths) {
			matchesByKey = null;
			matchedQuery = "";
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		if (!sessionEnabled) {
			matchesByKey = null;
			matchedQuery = "";
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
		}

		const nextWorkerDataset = sessionEnabled
			? workerDataset
			: lastSyncedWorkerDataset;
		const shouldSyncContents =
			contentSyncCanTrackPaths &&
			shouldSyncWorkerFileContents({
				sessionEnabled,
				matchScope: currentMatchScope,
				query: query(),
				partialSyncEnabled,
				contentIndexIsLoading: contentIndex.isLoading(),
			});
		const contentDiff = contentSyncCanTrackPaths
			? diffSearchWorkerFileContentsFromVisitor(
					(visitor) => contentIndex.forEachEntry(visitor),
					lastSyncedFileContentsByPath,
					shouldSyncContents,
				)
			: {
					changed: false,
					upserts: [],
					removals: [],
					nextEntriesByPath: null,
				};
		const datasetChanged =
			nextWorkerDataset !== null &&
			sessionEnabled &&
			nextWorkerDataset !== lastSyncedWorkerDataset;
		if (!datasetChanged && !contentDiff.changed) {
			return;
		}

		syncedDatasetVersion += 1;
		if (datasetChanged && nextWorkerDataset !== null) {
			searchWorkerClient.syncItems({
				datasetVersion: syncedDatasetVersion,
				items: nextWorkerDataset,
			});
			lastSyncedWorkerDataset = nextWorkerDataset;
		}

		if (contentDiff.upserts.length > 0) {
			searchWorkerClient.upsertFileContents({
				datasetVersion: syncedDatasetVersion,
				entries: contentDiff.upserts,
			});
		}
		if (contentDiff.removals.length > 0) {
			searchWorkerClient.removeFileContents({
				datasetVersion: syncedDatasetVersion,
				paths: contentDiff.removals,
			});
		}
		if (contentDiff.changed) {
			lastSyncedFileContentsByPath = contentDiff.nextEntriesByPath ?? new Map();
		}
	});

	$effect(() => {
		void syncedDatasetVersion;

		if (!sessionEnabled) {
			cancelFallbackSearch();
			requestSerial += 1;
			matchesByKey = null;
			matchedQuery = "";
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		const normalizedQuery = query();
		if (!normalizedQuery) {
			cancelFallbackSearch();
			requestSerial += 1;
			matchesByKey = null;
			matchedQuery = "";
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		issueSearchFilter(normalizedQuery);
	});

	const issueSearchFilter = (normalizedQuery: string): void => {
		const requestScope = currentMatchScope;
		const signature = `${syncedDatasetVersion}:${requestScope}:${normalizedQuery}`;
		if (signature === lastIssuedSearchSignature) {
			return;
		}

		if (
			matchesByKey !== null &&
			(matchedQuery !== normalizedQuery || matchedScope !== requestScope)
		) {
			matchesByKey = null;
			matchedQuery = "";
		}

		lastIssuedSearchSignature = signature;
		const requestId = ++requestSerial;
		activeRequestQuery = normalizedQuery;
		activeRequestScope = requestScope;
		cancelFallbackSearch();
		if (workerUnavailable) {
			issueFallbackSearch(normalizedQuery, requestId, requestScope);
			return;
		}

		isWorkerFiltering = true;
		searchWorkerClient.filter({
			requestId,
			datasetVersion: syncedDatasetVersion,
			query: normalizedQuery,
			matchScope: requestScope,
		});
	};

	return {
		get matchesByKey() {
			return matchesByKey;
		},
		get matchedQuery() {
			return matchedQuery;
		},
		get matchedScope() {
			return matchedScope;
		},
		get isFiltering() {
			return isWorkerFiltering;
		},
		get isLoading() {
			return isSearchLoading;
		},
		contentIndex,
		getFirstMatchPosition(
			query: string,
			targetFile: TFile | null | undefined,
		): Pos | undefined {
			if (!targetFile) {
				return undefined;
			}

			return contentIndex.getFirstMatchPosition(query, targetFile);
		},
	};
}
