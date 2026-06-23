import { onDestroy } from "svelte";
import type { App, Pos, TFile } from "obsidian";
import { createSearchWorkerClient } from "./searchWorkerClient";
import {
	useFileContentIndex,
	type FileContentIndexResult,
} from "./useFileContentIndex.svelte";
import type { SearchContentIndexEntry } from "./fileContentSearchIndex";
import type {
	SearchWorkerMatchScope,
	SearchWorkerItemSnapshot,
	SearchWorkerMatchedItem,
} from "./searchWorkerTypes";
import {
	shouldSyncWorkerFileContents,
	diffSearchWorkerFileContentsFromVisitor,
} from "./searchWorkerContentSync";
import {
	searchRipgrepContentByTerm,
	filterSearchDatasetWithRipgrepMatches,
	collectUniqueTargetFilePaths,
} from "./ripgrepContentSearch";

const EMPTY_SEARCH_WORKER_ITEMS: SearchWorkerItemSnapshot[] = [];
const EMPTY_RIPGREP_POSITION_BY_PATH = new Map<string, Pos>();

export type ContentSearchBackend = "worker" | "ripgrep";

export interface UseWorkerSearchSessionOptions {
	app: App;
	query: () => string;
	enabled?: boolean | (() => boolean);
	matchScope?: SearchWorkerMatchScope | (() => SearchWorkerMatchScope);
	getSearchableFiles: () => TFile[];
	buildDataset: () => SearchWorkerItemSnapshot[];
	contentSyncMode?: "eager" | "when-idle" | "progressive";
	progressiveSyncIntervalMs?: number;
	contentSearchBackend?: ContentSearchBackend | (() => ContentSearchBackend);
	ripgrepExecutablePath?: string | (() => string | undefined);
}

export interface WorkerSearchSessionResult {
	readonly matchedKeySet: Set<string> | null;
	readonly matchedItemByKey: Map<string, SearchWorkerMatchedItem> | null;
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
		matchScope = "title-and-content",
		getSearchableFiles,
		buildDataset,
		contentSyncMode = "eager",
		progressiveSyncIntervalMs = 400,
		contentSearchBackend = "worker",
		ripgrepExecutablePath,
	} = options;
	const isEnabled = (): boolean =>
		typeof enabled === "function" ? enabled() : enabled;
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
	let progressiveTick = $state(0);
	let ripgrepBackendUnavailable = $state(false);
	let lastRipgrepConfigSignature = "";
	let lastProgressiveQuerySignature = "";
	const getEffectiveContentSearchBackend = (): ContentSearchBackend =>
		getContentSearchBackend() === "ripgrep" && !ripgrepBackendUnavailable
			? "ripgrep"
			: "worker";
	const contentIndex = useFileContentIndex(app, getSearchableFiles, {
		enabled: () =>
			sessionEnabled &&
			currentMatchScope === "title-and-content" &&
			getEffectiveContentSearchBackend() !== "ripgrep",
	});
	const buildWorkerDataset = (): SearchWorkerItemSnapshot[] => {
		if (!sessionEnabled) {
			return EMPTY_SEARCH_WORKER_ITEMS;
		}

		return buildDataset();
	};

	let workerDataset = $derived.by(buildWorkerDataset);
	let matchedKeySet = $state<Set<string> | null>(null);
	let matchedItemByKey = $state<Map<string, SearchWorkerMatchedItem> | null>(null);
	let ripgrepPositionByPath = $state<Map<string, Pos>>(
		EMPTY_RIPGREP_POSITION_BY_PATH,
	);
	let isWorkerFiltering = $state(false);
	let syncedDatasetVersion = $state(0);
	let requestSerial = 0;
	let ripgrepRequestSerial = 0;
	let ripgrepAbortController: AbortController | null = null;
	let lastIssuedSearchSignature = "";
	let lastSyncedWorkerDataset: SearchWorkerItemSnapshot[] | null = null;
	let lastSyncedFileContentsByPath = new Map<
		string,
		Readonly<SearchContentIndexEntry>
	>();

	const searchWorkerClient = createSearchWorkerClient((message) => {
		if (message.type === "error") {
			isWorkerFiltering = false;
			return;
		}

		if (message.datasetVersion !== syncedDatasetVersion) {
			return;
		}

		if (message.requestId !== requestSerial) {
			return;
		}

		let matchedItems = message.matchedItems;
		if (!matchedItems) {
			const matchedKeys = message.matchedKeys ?? [];
			matchedItems = new Array<SearchWorkerMatchedItem>(matchedKeys.length);
			for (let index = 0; index < matchedKeys.length; index += 1) {
				matchedItems[index] = {
					key: matchedKeys[index],
					titleMatched: true,
					contentMatched: false,
				};
			}
		}
		const nextMatchedKeySet = new Set<string>();
		const nextMatchedItemByKey = new Map<string, SearchWorkerMatchedItem>();
		for (const item of matchedItems) {
			nextMatchedKeySet.add(item.key);
			nextMatchedItemByKey.set(item.key, item);
		}
		matchedKeySet = nextMatchedKeySet;
		matchedItemByKey = nextMatchedItemByKey;
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

	onDestroy(() => {
		cancelRipgrepSearch();
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
		if (contentSyncMode !== "progressive") {
			progressiveTick = 0;
			lastProgressiveQuerySignature = "";
			return;
		}

		const normalizedQuery =
			sessionEnabled && currentMatchScope === "title-and-content" ? query() : "";
		if (normalizedQuery === lastProgressiveQuerySignature) {
			return;
		}

		lastProgressiveQuerySignature = normalizedQuery;
		progressiveTick = 0;
	});

	$effect(() => {
		if (contentSyncMode !== "progressive") {
			return;
		}

		if (
			!sessionEnabled ||
			currentMatchScope !== "title-and-content" ||
			getEffectiveContentSearchBackend() === "ripgrep" ||
			!query() ||
			!contentIndex.isLoading()
		) {
			return;
		}

		const timer = window.setInterval(() => {
			progressiveTick += 1;
		}, progressiveSyncIntervalMs);

		return () => {
			window.clearInterval(timer);
		};
	});

	$effect(() => {
		if (!sessionEnabled) {
			matchedKeySet = null;
			matchedItemByKey = null;
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		const nextWorkerDataset = workerDataset;
		const shouldSyncContents =
			getEffectiveContentSearchBackend() !== "ripgrep" &&
			shouldSyncWorkerFileContents({
				sessionEnabled,
				matchScope: currentMatchScope,
				query: query(),
				contentSyncMode,
				progressiveTick,
				contentIndexIsLoading: contentIndex.isLoading(),
			});
		const contentDiff = diffSearchWorkerFileContentsFromVisitor(
			(visitor) => contentIndex.forEachEntry(visitor),
			lastSyncedFileContentsByPath,
			shouldSyncContents,
		);
		const datasetChanged = nextWorkerDataset !== lastSyncedWorkerDataset;
		if (!datasetChanged && !contentDiff.changed) {
			return;
		}

		syncedDatasetVersion += 1;
		if (datasetChanged) {
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
			requestSerial += 1;
			matchedKeySet = null;
			matchedItemByKey = null;
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		void getEffectiveContentSearchBackend();
		const normalizedQuery = query();
		if (!normalizedQuery) {
			cancelRipgrepSearch();
			requestSerial += 1;
			matchedKeySet = null;
			matchedItemByKey = null;
			ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
			isWorkerFiltering = false;
			lastIssuedSearchSignature = "";
			return;
		}

		issueSearchFilter(normalizedQuery);
	});

	const issueSearchFilter = (normalizedQuery: string): void => {
		const backend = getEffectiveContentSearchBackend();
		const signature = `${syncedDatasetVersion}:${currentMatchScope}:${backend}:${normalizedQuery}`;
		if (signature === lastIssuedSearchSignature) {
			return;
		}

		lastIssuedSearchSignature = signature;
		const requestId = ++requestSerial;
		if (backend === "ripgrep" && currentMatchScope === "title-and-content") {
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
						ripgrepResult.positionByPath,
					);
					const nextMatchedKeySet = new Set<string>();
					const nextMatchedItemByKey = new Map<
						string,
						SearchWorkerMatchedItem
					>();
					for (const item of matchedItems) {
						nextMatchedKeySet.add(item.key);
						nextMatchedItemByKey.set(item.key, item);
					}
					matchedKeySet = nextMatchedKeySet;
					matchedItemByKey = nextMatchedItemByKey;
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
					ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
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
		isWorkerFiltering = true;
		ripgrepPositionByPath = EMPTY_RIPGREP_POSITION_BY_PATH;
		searchWorkerClient.filter({
			requestId,
			datasetVersion: syncedDatasetVersion,
			query: normalizedQuery,
			matchScope: currentMatchScope,
		});
	};

	return {
		get matchedKeySet() {
			return matchedKeySet;
		},
		get matchedItemByKey() {
			return matchedItemByKey;
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
