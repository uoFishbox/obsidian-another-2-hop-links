import type { App, Pos, TFile } from "obsidian";
import { onDestroy, untrack } from "svelte";
import { getFileContentVaultEventHub } from "./fileContentVaultEventHub";
import { runStreamingSearch, type StreamingSearchUpdate } from "./streamingSearch";
import type {
	SearchContentMatch,
	SearchItemSnapshot,
	SearchMatchedItem,
	SearchMatchScope,
} from "./searchTypes";
import { getFileContent } from "preview/pipeline/previewContent";

const EMPTY_SEARCH_SNAPSHOT: SearchDatasetSnapshot = {
	items: [],
	searchableFiles: [],
};

export interface SearchDatasetSnapshot {
	readonly items: readonly SearchItemSnapshot[];
	readonly searchableFiles: readonly TFile[];
}

export interface UseStreamingSearchSessionOptions {
	app: App;
	query: () => string;
	enabled?: boolean | (() => boolean);
	matchScope?: SearchMatchScope | (() => SearchMatchScope);
	buildSnapshot: () => SearchDatasetSnapshot;
}

interface SearchRequestIdentity {
	readonly query: string;
	readonly scope: SearchMatchScope;
	readonly datasetRevision: number;
	readonly contentRevision: number;
}

export interface SearchResultSnapshot extends SearchRequestIdentity {
	readonly requestId: number;
	readonly matchesByKey: ReadonlyMap<string, SearchMatchedItem>;
	readonly orderedMatches: readonly SearchMatchedItem[];
	readonly firstContentMatchByPath: ReadonlyMap<string, SearchContentMatch>;
}

export type SearchMatchSnapshot = SearchResultSnapshot;
export type SearchPhase = "idle" | "filtering" | "ready" | "failed";
export type VisibleSearchResult =
	| { readonly type: "current"; readonly result: SearchResultSnapshot }
	| { readonly type: "stale"; readonly result: SearchResultSnapshot };

export interface StreamingSearchSessionResult {
	readonly visibleResult: VisibleSearchResult | null;
	readonly phase: SearchPhase;
	readonly isPending: boolean;
	getFirstMatchOffset(
		query: string,
		targetFile: TFile | null | undefined,
	): SearchContentMatch | undefined;
	resolveFirstMatchPosition(
		query: string,
		targetFile: TFile | null | undefined,
	): Promise<Pos | undefined>;
}

function isSameRequest(
	left: SearchRequestIdentity | null,
	right: SearchRequestIdentity | null,
): boolean {
	if (!left || !right) return left === right;
	return (
		left.query === right.query &&
		left.scope === right.scope &&
		left.datasetRevision === right.datasetRevision &&
		left.contentRevision === right.contentRevision
	);
}

/** Creates a cancellable, on-demand search session without a resident index. */
export function useStreamingSearchSession(
	options: UseStreamingSearchSessionOptions,
): StreamingSearchSessionResult {
	const { app, query, enabled = true, matchScope = "title-and-content" } = options;
	const isEnabled = (): boolean =>
		typeof enabled === "function" ? enabled() : enabled;
	const getMatchScope = (): SearchMatchScope =>
		typeof matchScope === "function" ? matchScope() : matchScope;
	let sessionEnabled = $derived(isEnabled());
	let currentMatchScope = $derived(getMatchScope());
	let searchSnapshot = $derived.by(() =>
		sessionEnabled ? options.buildSnapshot() : EMPTY_SEARCH_SNAPSHOT,
	);
	let datasetRevision = $state(0);
	let contentRevision = $state(0);
	let lastSearchSnapshot: SearchDatasetSnapshot | null = null;
	let nextRequestId = 0;
	let activeSerial = 0;
	let activeRequest: SearchRequestIdentity | null = null;
	let failedRequest = $state.raw<SearchRequestIdentity | null>(null);
	let committedResult = $state.raw<SearchResultSnapshot | null>(null);
	let progressiveResult = $state.raw<SearchResultSnapshot | null>(null);
	const positionPromises = new Map<string, Promise<Pos | undefined>>();

	$effect(() => {
		const nextSnapshot = searchSnapshot;
		if (nextSnapshot === lastSearchSnapshot) return;
		lastSearchSnapshot = nextSnapshot;
		datasetRevision += 1;
	});

	$effect(() => {
		if (!sessionEnabled || !query() || currentMatchScope !== "title-and-content") {
			return;
		}

		const activePaths = new Set(
			searchSnapshot.searchableFiles.map((file) => file.path),
		);
		return getFileContentVaultEventHub(app).subscribe((file, oldPath) => {
			if (activePaths.has(file.path) || (oldPath && activePaths.has(oldPath))) {
				contentRevision += 1;
			}
		});
	});

	let desiredRequest = $derived.by((): SearchRequestIdentity | null => {
		const normalizedQuery = query();
		if (!sessionEnabled || !normalizedQuery) return null;
		return {
			query: normalizedQuery,
			scope: currentMatchScope,
			datasetRevision,
			contentRevision,
		};
	});

	let currentResult = $derived.by(() =>
		committedResult && isSameRequest(committedResult, desiredRequest)
			? committedResult
			: null,
	);
	let currentProgressiveResult = $derived.by(() =>
		progressiveResult && isSameRequest(progressiveResult, desiredRequest)
			? progressiveResult
			: null,
	);
	let visibleResult = $derived.by(() => {
		if (!desiredRequest) return null;
		if (currentResult) return { type: "current" as const, result: currentResult };
		if (currentProgressiveResult) {
			return { type: "current" as const, result: currentProgressiveResult };
		}
		return committedResult?.query === desiredRequest.query &&
			committedResult.scope === desiredRequest.scope
			? { type: "stale" as const, result: committedResult }
			: null;
	});
	let phase = $derived.by((): SearchPhase => {
		if (!desiredRequest) return "idle";
		if (failedRequest && isSameRequest(failedRequest, desiredRequest)) {
			return "failed";
		}
		if (currentResult) return "ready";
		return "filtering";
	});

	function cancelActiveSearch(): void {
		activeSerial += 1;
		activeRequest = null;
	}

	function toSnapshot(
		request: SearchRequestIdentity,
		requestId: number,
		matchesByKey: ReadonlyMap<string, SearchMatchedItem>,
		orderedMatches: readonly SearchMatchedItem[],
		firstContentMatchByPath: ReadonlyMap<string, SearchContentMatch>,
	): SearchResultSnapshot {
		return {
			...request,
			requestId,
			matchesByKey,
			orderedMatches,
			firstContentMatchByPath,
		};
	}

	function issueSearch(request: SearchRequestIdentity): void {
		cancelActiveSearch();
		positionPromises.clear();
		const serial = activeSerial;
		const requestId = ++nextRequestId;
		activeRequest = request;
		failedRequest = null;
		progressiveResult = null;
		const { items: itemsSnapshot, searchableFiles: filesSnapshot } = searchSnapshot;
		const matchesByKey = new Map<string, SearchMatchedItem>();
		const orderedMatches: SearchMatchedItem[] = [];
		const firstContentMatchByPath = new Map<string, SearchContentMatch>();

		void runStreamingSearch({
			vault: app.vault,
			items: itemsSnapshot,
			files: filesSnapshot,
			query: request.query,
			scope: request.scope,
			isCancelled: () =>
				serial !== activeSerial ||
				activeRequest !== request ||
				!isSameRequest(
					request,
					untrack(() => desiredRequest),
				),
			onUpdate: (update: StreamingSearchUpdate) => {
				if (
					serial !== activeSerial ||
					activeRequest !== request ||
					!isSameRequest(
						request,
						untrack(() => desiredRequest),
					)
				) {
					return;
				}
				for (const match of update.addedMatches) {
					if (matchesByKey.has(match.key)) continue;
					matchesByKey.set(match.key, match);
					orderedMatches.push(match);
				}
				for (const entry of update.addedContentMatches) {
					if (!firstContentMatchByPath.has(entry.path)) {
						firstContentMatchByPath.set(entry.path, entry.match);
					}
				}
				const snapshot = toSnapshot(
					request,
					requestId,
					matchesByKey,
					orderedMatches,
					firstContentMatchByPath,
				);
				if (update.complete) {
					committedResult = snapshot;
					progressiveResult = null;
					activeRequest = null;
					return;
				}
				progressiveResult = snapshot;
			},
		}).catch(() => {
			if (serial !== activeSerial || activeRequest !== request) return;
			failedRequest = request;
			progressiveResult = null;
			activeRequest = null;
		});
	}

	$effect(() => {
		const desired = desiredRequest;
		if (!desired) {
			cancelActiveSearch();
			progressiveResult = null;
			return;
		}
		if (activeRequest && isSameRequest(activeRequest, desired)) return;
		if (committedResult && isSameRequest(committedResult, desired)) return;
		issueSearch(desired);
	});

	onDestroy(cancelActiveSearch);

	return {
		get visibleResult() {
			return visibleResult;
		},
		get phase() {
			return phase;
		},
		get isPending() {
			return phase === "filtering";
		},
		getFirstMatchOffset(searchQuery, targetFile) {
			if (!targetFile) return undefined;
			const result = getResultForQuery(searchQuery);
			return result?.firstContentMatchByPath.get(targetFile.path);
		},
		resolveFirstMatchPosition(searchQuery, targetFile) {
			if (!targetFile) return Promise.resolve(undefined);
			const result = getResultForQuery(searchQuery);
			const match = result?.firstContentMatchByPath.get(targetFile.path);
			if (!match) return Promise.resolve(undefined);
			const cacheKey = `${result?.requestId ?? 0}\u001f${targetFile.path}`;
			const cached = positionPromises.get(cacheKey);
			if (cached) return cached;

			const promise = getFileContent(targetFile, app.vault)
				.then((content) => buildPosFromOffset(content, match))
				.catch(() => undefined);
			positionPromises.set(cacheKey, promise);
			return promise;
		},
	};

	function getResultForQuery(searchQuery: string): SearchResultSnapshot | null {
		const normalizedQuery = searchQuery.trim().toLowerCase();
		return (
			currentResult ??
			(currentProgressiveResult?.query === normalizedQuery
				? currentProgressiveResult
				: committedResult?.query === normalizedQuery
					? committedResult
					: null)
		);
	}
}

function buildPosFromOffset(content: string, match: SearchContentMatch): Pos {
	const startOffset = Math.min(Math.max(0, match.offset), content.length);
	const endOffset = Math.min(content.length, startOffset + Math.max(1, match.length));
	let line = 0;
	let lineStartOffset = 0;
	let startLine = 0;
	let startLineOffset = 0;

	for (let index = 0; index < endOffset; index += 1) {
		if (index === startOffset) {
			startLine = line;
			startLineOffset = lineStartOffset;
		}
		if (content.charCodeAt(index) !== 10) continue;
		line += 1;
		lineStartOffset = index + 1;
	}
	if (startOffset === endOffset) {
		startLine = line;
		startLineOffset = lineStartOffset;
	}

	return {
		start: {
			line: startLine,
			col: startOffset - startLineOffset,
			offset: startOffset,
		},
		end: {
			line,
			col: endOffset - lineStartOffset,
			offset: endOffset,
		},
	};
}
