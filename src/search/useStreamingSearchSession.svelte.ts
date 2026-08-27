import type { App, Pos, TFile } from "obsidian";
import { onDestroy, untrack } from "svelte";
import { getFileContentVaultEventHub } from "./fileContentVaultEventHub";
import { runStreamingSearch, type StreamingSearchUpdate } from "./streamingSearch";
import type {
	SearchItemSnapshot,
	SearchMatchedItem,
	SearchMatchScope,
} from "./searchTypes";

const EMPTY_SEARCH_ITEMS: readonly SearchItemSnapshot[] = [];

export interface UseStreamingSearchSessionOptions {
	app: App;
	query: () => string;
	enabled?: boolean | (() => boolean);
	matchScope?: SearchMatchScope | (() => SearchMatchScope);
	getSearchableFiles: () => readonly TFile[];
	buildDataset: () => readonly SearchItemSnapshot[];
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
	readonly firstContentMatchPositionByPath: ReadonlyMap<string, Pos>;
}

export type SearchMatchSnapshot = SearchResultSnapshot;
export type SearchPhase = "idle" | "filtering" | "ready" | "failed";

export interface StreamingSearchSessionResult {
	readonly committedResult: SearchResultSnapshot | null;
	readonly currentResult: SearchResultSnapshot | null;
	readonly progressiveResult: SearchResultSnapshot | null;
	readonly phase: SearchPhase;
	readonly isPending: boolean;
	readonly isShowingStaleResult: boolean;
	getFirstMatchPosition(
		query: string,
		targetFile: TFile | null | undefined,
	): Pos | undefined;
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
	let dataset = $derived.by(() =>
		sessionEnabled ? options.buildDataset() : EMPTY_SEARCH_ITEMS,
	);
	let datasetRevision = $state(0);
	let contentRevision = $state(0);
	let lastDataset: readonly SearchItemSnapshot[] | null = null;
	let nextRequestId = 0;
	let activeSerial = 0;
	let activeRequest: SearchRequestIdentity | null = null;
	let failedRequest = $state.raw<SearchRequestIdentity | null>(null);
	let committedResult = $state.raw<SearchResultSnapshot | null>(null);
	let progressiveResult = $state.raw<SearchResultSnapshot | null>(null);

	$effect(() => {
		const nextDataset = dataset;
		if (nextDataset === lastDataset) return;
		lastDataset = nextDataset;
		datasetRevision += 1;
	});

	$effect(() => {
		if (!sessionEnabled || !query() || currentMatchScope !== "title-and-content") {
			return;
		}

		const activePaths = new Set(
			options.getSearchableFiles().map((file) => file.path),
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
		update: StreamingSearchUpdate,
	): SearchResultSnapshot {
		return {
			...request,
			requestId,
			matchesByKey: update.matchesByKey,
			firstContentMatchPositionByPath: update.firstContentMatchPositionByPath,
		};
	}

	function issueSearch(request: SearchRequestIdentity): void {
		cancelActiveSearch();
		const serial = activeSerial;
		const requestId = ++nextRequestId;
		activeRequest = request;
		failedRequest = null;
		progressiveResult = null;
		const itemsSnapshot = dataset;
		const filesSnapshot = options.getSearchableFiles();

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
			onUpdate: (update) => {
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
				const snapshot = toSnapshot(request, requestId, update);
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
		get committedResult() {
			return committedResult;
		},
		get currentResult() {
			return currentResult;
		},
		get progressiveResult() {
			return currentProgressiveResult;
		},
		get phase() {
			return phase;
		},
		get isPending() {
			return phase === "filtering";
		},
		get isShowingStaleResult() {
			return (
				committedResult !== null && currentResult === null && phase !== "idle"
			);
		},
		getFirstMatchPosition(searchQuery, targetFile) {
			if (!targetFile) return undefined;
			const normalizedQuery = searchQuery.trim().toLowerCase();
			const result =
				currentResult ??
				(currentProgressiveResult?.query === normalizedQuery
					? currentProgressiveResult
					: committedResult?.query === normalizedQuery
						? committedResult
						: null);
			return result?.firstContentMatchPositionByPath.get(targetFile.path);
		},
	};
}
