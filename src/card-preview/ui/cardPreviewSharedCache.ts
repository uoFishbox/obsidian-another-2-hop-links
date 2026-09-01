import type { TFile, Vault } from "obsidian";
import {
	getContentSnippetAsync,
	highlightSearchMatchesInHtmlAsync,
} from "card-preview/text/previewTextProcessingAsync";
import { type GetContentSnippetOptions } from "card-preview/text/snippetExtractor";
import {
	findCaseInsensitiveIndex,
	htmlVisibleTextContainsCaseInsensitive,
} from "card-preview/text/searchUtils";
import {
	analyzePreviewContent,
	type PreviewContentAnalysis,
} from "card-preview/pipeline/previewContent";
import {
	readRawContent,
	type RawContentLoader,
} from "card-preview/pipeline/rawContentReader";
import { throwIfAborted } from "card-preview/pipeline/previewAbort";
import type { PreviewRenderSettings } from "card-preview/pipeline/previewRenderSettings";
import {
	attachSharedCaller,
	createSharedAbortableRequest,
	type SharedAbortableRequest,
} from "card-preview/pipeline/sharedAbortableRequest";
import { createSizedLRUCache, stringBytes } from "shared/cache/sizedLRUCache";

const SEARCH_CONTEXT_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const PREVIEW_ANALYSIS_CACHE_MAX_BYTES = 2 * 1024 * 1024;

type SharedInFlightRequest<T> = SharedAbortableRequest<T> & {
	readonly cacheKey: string;
};

interface CardPreviewSharedCacheState {
	readonly searchContextPreviewCache: ReturnType<
		typeof createSearchContextPreviewCache
	>;
	readonly searchContextPreviewInFlight: Map<string, SharedInFlightRequest<string>>;
	readonly previewAnalysisCache: ReturnType<typeof createPreviewAnalysisCache>;
}

function createSearchContextPreviewCache() {
	return createSizedLRUCache<string, string>(SEARCH_CONTEXT_CACHE_MAX_BYTES);
}

function createPreviewAnalysisCache() {
	return createSizedLRUCache<string, PreviewContentAnalysis>(
		PREVIEW_ANALYSIS_CACHE_MAX_BYTES,
	);
}

function createCacheState(): CardPreviewSharedCacheState {
	return {
		searchContextPreviewCache: createSearchContextPreviewCache(),
		searchContextPreviewInFlight: new Map(),
		previewAnalysisCache: createPreviewAnalysisCache(),
	};
}

const EMPTY_PREVIEW_PROTECTED_SEGMENTS: PreviewContentAnalysis["protectedSegments"] =
	[];

function estimatePreviewAnalysisSize(analysis: PreviewContentAnalysis): number {
	return (
		256 +
		stringBytes(analysis.contentForMathParsing) +
		analysis.protectedSegments.reduce(
			(size, segment) =>
				size + stringBytes(segment.token) + stringBytes(segment.html),
			0,
		)
	);
}

function previewContentHasVisibleQuery(
	previewContent: string,
	normalizedQuery: string,
): boolean {
	if (!normalizedQuery) {
		return false;
	}

	return htmlVisibleTextContainsCaseInsensitive(previewContent, normalizedQuery);
}

function abortSharedRequests<T>(requests: Map<string, SharedInFlightRequest<T>>): void {
	for (const request of requests.values()) {
		request.controller.abort();
	}
	requests.clear();
}

function resolveFirstMatchIndex(
	rawContent: string,
	normalizedQuery: string,
	firstMatchOffsetInput: number | (() => number | undefined) | undefined,
): number {
	const firstMatchOffset =
		typeof firstMatchOffsetInput === "function"
			? firstMatchOffsetInput()
			: firstMatchOffsetInput;
	if (
		typeof firstMatchOffset === "number" &&
		Number.isFinite(firstMatchOffset) &&
		firstMatchOffset >= 0 &&
		firstMatchOffset < rawContent.length
	) {
		return Math.floor(firstMatchOffset);
	}

	return findCaseInsensitiveIndex(rawContent, normalizedQuery);
}

async function applySharedSearchContextToTextPreviewForState(
	state: CardPreviewSharedCacheState,
	params: {
		previewContent: string;
		cacheKey: string;
		targetFile: TFile;
		normalizedQuery: string;
		firstMatchOffset?: number | (() => number | undefined);
		settings: PreviewRenderSettings;
		vault: Vault;
		getRawContent?: RawContentLoader;
		signal?: AbortSignal;
	},
): Promise<string> {
	const {
		previewContent,
		cacheKey,
		targetFile,
		normalizedQuery,
		firstMatchOffset,
		settings,
		vault,
		getRawContent,
		signal,
	} = params;
	const cached = state.searchContextPreviewCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const existingRequest = state.searchContextPreviewInFlight.get(cacheKey);
	if (existingRequest && !existingRequest.controller.signal.aborted) {
		return attachSharedCaller(existingRequest, signal, "Preview request aborted");
	}
	if (existingRequest) {
		state.searchContextPreviewInFlight.delete(cacheKey);
	}

	const request: SharedInFlightRequest<string> = {
		cacheKey,
		...createSharedAbortableRequest(async (sharedSignal) => {
			throwIfAborted(sharedSignal, "Preview request aborted");
			let contentForRender = previewContent;
			if (!previewContentHasVisibleQuery(previewContent, normalizedQuery)) {
				const rawContent = getRawContent
					? await getRawContent(targetFile, sharedSignal)
					: await readRawContent(targetFile, vault, sharedSignal);
				throwIfAborted(sharedSignal, "Preview request aborted");

				const firstMatchIndex = resolveFirstMatchIndex(
					rawContent,
					normalizedQuery,
					firstMatchOffset,
				);
				throwIfAborted(sharedSignal, "Preview request aborted");

				if (firstMatchIndex !== -1) {
					const snippetOptions: GetContentSnippetOptions = {
						firstMatchIndex,
					};
					throwIfAborted(sharedSignal, "Preview request aborted");
					contentForRender = await getContentSnippetAsync(
						rawContent,
						settings,
						normalizedQuery,
						snippetOptions,
						sharedSignal,
					);
				}
			}

			throwIfAborted(sharedSignal, "Preview request aborted");
			const highlightedContent = await highlightSearchMatchesInHtmlAsync(
				contentForRender,
				normalizedQuery,
				sharedSignal,
			);
			throwIfAborted(sharedSignal, "Preview request aborted");
			state.searchContextPreviewCache.set(
				cacheKey,
				highlightedContent,
				stringBytes(highlightedContent),
			);
			return highlightedContent;
		}),
	};
	state.searchContextPreviewInFlight.set(cacheKey, request);
	void request.promise.then(
		() => finalizeSharedRequest(state.searchContextPreviewInFlight, request),
		() => finalizeSharedRequest(state.searchContextPreviewInFlight, request),
	);

	return attachSharedCaller(request, signal, "Preview request aborted");
}

function finalizeSharedRequest<T>(
	map: Map<string, SharedInFlightRequest<T>>,
	request: SharedInFlightRequest<T>,
): void {
	if (map.get(request.cacheKey) === request) {
		map.delete(request.cacheKey);
	}
}

function getSharedPreviewAnalysisForState(
	state: CardPreviewSharedCacheState,
	cacheKey: string,
	content: string,
): PreviewContentAnalysis {
	if (!content.includes("$")) {
		return {
			hasDollar: false,
			hasMathExpression: false,
			contentForMathParsing: content,
			protectedSegments: EMPTY_PREVIEW_PROTECTED_SEGMENTS,
		};
	}

	const cached = state.previewAnalysisCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const analysis = analyzePreviewContent(content);
	state.previewAnalysisCache.set(
		cacheKey,
		analysis,
		estimatePreviewAnalysisSize(analysis),
	);
	return analysis;
}

// Used by tests to isolate module-scope caches.
function clearCacheState(state: CardPreviewSharedCacheState): void {
	state.searchContextPreviewCache.clear();
	abortSharedRequests(state.searchContextPreviewInFlight);
	state.previewAnalysisCache.clear();
}

/** Runtime-owned search-context and preview-analysis caches. */
export interface CardPreviewSharedCache {
	applySharedSearchContextToTextPreview(
		params: Parameters<typeof applySharedSearchContextToTextPreviewForState>[1],
	): Promise<string>;
	getSharedPreviewAnalysis(cacheKey: string, content: string): PreviewContentAnalysis;
	clear(): void;
}

/** Creates caches isolated to one PreviewRuntime. */
export function createCardPreviewSharedCache(): CardPreviewSharedCache {
	const state = createCacheState();
	return createCacheFacade(state);
}

function createCacheFacade(state: CardPreviewSharedCacheState): CardPreviewSharedCache {
	return {
		applySharedSearchContextToTextPreview: (params) =>
			applySharedSearchContextToTextPreviewForState(state, params),
		getSharedPreviewAnalysis: (cacheKey, content) =>
			getSharedPreviewAnalysisForState(state, cacheKey, content),
		clear: () => clearCacheState(state),
	};
}
