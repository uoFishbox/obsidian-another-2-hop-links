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
import {
	searchRipgrepContentByTerm,
	filterSearchDatasetWithRipgrepMatches,
	collectUniqueTargetFilePaths,
} from "./ripgrepContentSearch";
import { filterSearchWorkerDatasetWithMatchDetailsTimeSliced } from "./searchWorkerFilter";

const EMPTY_SEARCH_WORKER_ITEMS: readonly SearchWorkerItemSnapshot[] = [];
const EMPTY_RIPGREP_POSITION_BY_PATH = new Map<string, Pos>();

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

export type ContentSearchBackend = "worker" | "ripgrep";

export interface UseWorkerSearchSessionOptions {
	app: App;
	query: () => string;
	enabled?: boolean | (() => boolean);
	contentIndexEnabled?: boolean | (() => boolean);
	matchScope?: SearchWorkerMatchScope | (() => SearchWorkerMatchScope);
	getSearchableFiles: () => readonly TFile[];
	buildDataset: () => readonly SearchWorkerItemSnapshot[];
	contentSearchBackend?: ContentSearchBackend | (() => ContentSearchBackend);
	ripgrepExecutablePath?: string | (() => string | undefined);
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
		contentSearchBackend = "worker",
		ripgrepExecutablePath,
	} = options;
	const isEnabled = (): boolean =>
		typeof enabled === "function" ? enabled() : enabled;
	const isContentIndexEnabled = (): boolean =>
		typeof contentIndexEnabled === "function"
			? contentIndexEnabled()
			: contentIndexEnabled;
	const getMatchScope = (): SearchWorkerMatchScope =>
		typeof matchScope === "function" ? matchScope() : matchScope;
	const getContentSearchBackend = (): ContentSearchBackend =>
		typeof contentSearchBackend === "function"
			? contentSearchBackend()
			: contentSearchBackend;
	const getRipgrepExecutablePath = (): string | undefined =>
		typeof ripgrepExecutablePath === "function"
			? ripgrepExecutablePath()
			: ripgrepExecutablePath;
	let sessionEnabled = $derived(isEnabled());
	let currentMatchScope = $derived(getMatchScope());
	let partialSyncEnabled = $state(false);
	let ripgrepBackendUnavailable = $state(false);
	let lastRipgrepConfigSignature = "";
	const getEffectiveContentSearchBackend = (): ContentSearchBackend =>
		getContentSearchBackend() === "ripgrep" && !ripgrepBackendUnavailable
			? "ripgrep"
			: "worker";
	const contentIndex = useFileContentIndex(app, getSearchableFiles, {
		enabled: () =>
			isContentIndexEnabled() &&
			currentMatchScope === "title-and-content" &&
			getEffectiveContentSearchBackend() !== "ripgrep",
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
	let ripgrepPositionByPath = $state<Map<string, Pos>>(
		EMPTY_RIPGREP_POSITION_BY_PATH,
	);
	let isWorkerFiltering = $state(false);
	let syncedDatasetVersion = $state(0);
	let requestSerial = 0;
	let activeRequestQuery = "";
	let activeRequestScope: SearchWorkerMatchScope = "title-only";
	let ripgrepRequestSerial = 0;
	let ripgrepAbortController: AbortController | null = null;
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
		ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
		isWorkerFiltering = false;
	});

	const cancelRipgrepSearch = (): void => {
		if (!ripgrepAbortController) {
			return;
		}

		ripgrepAbortController.abort();
		ripgrepAbortController = null;
		ripgrepRequestSerial += 1;
	};

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
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
		});
	};

	onDestroy(() => {
		cancelRipgrepSearch();
		cancelFallbackSearch();
		searchWorkerClient.terminate();
	});

	let isSearchLoading = $derived(
		sessionEnabled &&
			!!query() &&
			((currentMatchScope === "title-and-content" &&
				getEffectiveContentSearchBackend() !== "ripgrep" &&
				contentIndex.isLoading()) ||
				isWorkerFiltering),
	);

	$effect(() => {
		const configuredBackend = getContentSearchBackend();
		const ripgrepConfigSignature = [
			configuredBackend,
			getRipgrepExecutablePath() ?? "",
		].join("|");

		if (configuredBackend !== "ripgrep") {
			ripgrepBackendUnavailable = false;
			lastRipgrepConfigSignature = ripgrepConfigSignature;
			return;
		}

		if (ripgrepConfigSignature !== lastRipgrepConfigSignature) {
			ripgrepBackendUnavailable = false;
			lastRipgrepConfigSignature = ripgrepConfigSignature;
		}
	});

	$effect(() => {
		const shouldWaitForPartialSync =
			sessionEnabled &&
			isContentIndexEnabled() &&
			currentMatchScope === "title-and-content" &&
			getEffectiveContentSearchBackend() === "worker" &&
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
			isContentIndexEnabled() &&
			currentMatchScope === "title-and-content" &&
			getEffectiveContentSearchBackend() !== "ripgrep";

		if (!sessionEnabled && !contentSyncCanTrackPaths) {
			matchesByKey = null;
			matchedQuery = "";
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		if (!sessionEnabled) {
			matchesByKey = null;
			matchedQuery = "";
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
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
			cancelRipgrepSearch();
			cancelFallbackSearch();
			requestSerial += 1;
			matchesByKey = null;
			matchedQuery = "";
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		void getEffectiveContentSearchBackend();
		const normalizedQuery = query();
		if (!normalizedQuery) {
			cancelRipgrepSearch();
			cancelFallbackSearch();
			requestSerial += 1;
			matchesByKey = null;
			matchedQuery = "";
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		issueSearchFilter(normalizedQuery);
	});

	const issueSearchFilter = (normalizedQuery: string): void => {
		const backend = getEffectiveContentSearchBackend();
		const requestScope = currentMatchScope;
		const signature = `${syncedDatasetVersion}:${requestScope}:${backend}:${normalizedQuery}`;
		if (signature === lastIssuedSearchSignature) {
			return;
		}

		if (
			matchesByKey !== null &&
			(matchedQuery !== normalizedQuery || matchedScope !== requestScope)
		) {
			matchesByKey = null;
			matchedQuery = "";
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
		}

		lastIssuedSearchSignature = signature;
		const requestId = ++requestSerial;
		activeRequestQuery = normalizedQuery;
		activeRequestScope = requestScope;
		if (backend === "ripgrep" && requestScope === "title-and-content") {
			cancelRipgrepSearch();
			const abortController = new AbortController();
			ripgrepAbortController = abortController;
			const ripgrepRequestId = ++ripgrepRequestSerial;
			isWorkerFiltering = true;

			void (async () => {
				try {
					const nextWorkerDataset = workerDataset;
					const targetFilePaths =
						collectUniqueTargetFilePaths(nextWorkerDataset);
					const ripgrepResult = await searchRipgrepContentByTerm(
						app,
						normalizedQuery,
						getRipgrepExecutablePath(),
						targetFilePaths,
						{ signal: abortController.signal },
					);

					if (ripgrepRequestId !== ripgrepRequestSerial) {
						return;
					}

					const matchedItems = filterSearchDatasetWithRipgrepMatches(
						nextWorkerDataset,
						normalizedQuery,
						ripgrepResult.matchesByTerm,
						ripgrepResult.previewByPath,
					);
					const nextMatchesByKey = new Map<string, SearchWorkerMatchedItem>();
					for (const item of matchedItems) {
						nextMatchesByKey.set(item.key, item);
					}
					matchesByKey = nextMatchesByKey;
					matchedQuery = normalizedQuery;
					matchedScope = requestScope;
					ripgrepPositionByPath = ripgrepResult.positionByPath;
					isWorkerFiltering = false;
				} catch {
					if (abortController.signal.aborted) {
						return;
					}

					if (ripgrepRequestId !== ripgrepRequestSerial) {
						return;
					}

					ripgrepBackendUnavailable = true;
					lastIssuedSearchSignature = "";
					isWorkerFiltering = false;
				} finally {
					if (ripgrepAbortController === abortController) {
						ripgrepAbortController = null;
					}
				}
			})();

			return;
		}

		cancelRipgrepSearch();
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

			return (
				ripgrepPositionByPath.get(targetFile.path) ??
				contentIndex.getFirstMatchPosition(query, targetFile)
			);
		},
	};
}
