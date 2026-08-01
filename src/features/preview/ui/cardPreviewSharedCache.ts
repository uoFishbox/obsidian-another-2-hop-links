import { Component } from "obsidian";
import type { App, TFile, Vault } from "obsidian";
import { processPreviewContent } from "features/preview/renderers/markdownPreviewRenderer";
import { enqueuePreviewRender } from "features/preview/renderers/previewRenderQueue";
import {
	getContentSnippetAsync,
	highlightSearchMatchesInHtmlAsync,
} from "features/preview/text-processing/previewTextProcessingAsync";
import { type GetContentSnippetOptions } from "features/preview/text-processing/snippetExtractor";
import {
	findCaseInsensitiveIndex,
	htmlVisibleTextContainsCaseInsensitive,
} from "features/preview/text-processing/searchUtils";
import {
	analyzePreviewContent,
	type PreviewContentAnalysis,
} from "features/preview/core/previewContent";
import { readRawContent } from "features/preview/core/rawContentReader";
import {
	CACHE_KEY_SEPARATOR,
	getPreviewSettingsSignatures,
} from "features/preview/core/previewRenderKeys";
import {
	createAbortError,
	isAbortError,
	throwIfAborted,
} from "features/preview/core/previewAbort";
import { getDebugDisableRenderedPreviewCache } from "../../../appConstants";
import type { PreviewRenderSettingsInput } from "features/preview/core/previewRenderSettings";
import { createSizedLRUCache, stringBytes } from "shared/cache/sizedLRUCache";

export type RenderedTextPreviewCacheEntry = {
	kind: "text";
	html: string;
	hasMath: boolean;
	estimatedBytes: number;
};

export type PreviewSearchContext = {
	query: string;
	firstMatchOffset?: number;
	matchedLine?: string;
	surroundingText?: string;
};

const RENDERED_PREVIEW_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const SEARCH_CONTEXT_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const PREVIEW_ANALYSIS_CACHE_MAX_BYTES = 2 * 1024 * 1024;

type SharedInFlightRequest<T> = {
	cacheKey: string;
	callerCount: number;
	controller: AbortController;
	promise: Promise<T>;
};

interface CardPreviewSharedCacheState {
	readonly renderedPreviewCache: ReturnType<typeof createRenderedPreviewCache>;
	readonly renderedPreviewTemplates: WeakMap<
		RenderedTextPreviewCacheEntry,
		HTMLTemplateElement
	>;
	readonly renderedPreviewInFlight: Map<
		string,
		SharedInFlightRequest<RenderedTextPreviewCacheEntry>
	>;
	readonly searchContextPreviewCache: ReturnType<
		typeof createSearchContextPreviewCache
	>;
	readonly searchContextPreviewInFlight: Map<string, SharedInFlightRequest<string>>;
	readonly previewAnalysisCache: ReturnType<typeof createPreviewAnalysisCache>;
}

function createRenderedPreviewCache() {
	return createSizedLRUCache<string, RenderedTextPreviewCacheEntry>(
		RENDERED_PREVIEW_CACHE_MAX_BYTES,
	);
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
		renderedPreviewCache: createRenderedPreviewCache(),
		renderedPreviewTemplates: new WeakMap(),
		renderedPreviewInFlight: new Map(),
		searchContextPreviewCache: createSearchContextPreviewCache(),
		searchContextPreviewInFlight: new Map(),
		previewAnalysisCache: createPreviewAnalysisCache(),
	};
}

const EMPTY_PREVIEW_PROTECTED_SEGMENTS: PreviewContentAnalysis["protectedSegments"] =
	[];

function estimateRenderedTextPreviewSize(html: string): number {
	return 128 + stringBytes(html);
}

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

function buildSearchContextCacheKey(
	previewContentIdentityKey: string,
	normalizedQuery: string,
	settings: PreviewRenderSettingsInput,
): string {
	const { searchSignature } = getPreviewSettingsSignatures(settings);
	return `${previewContentIdentityKey}${CACHE_KEY_SEPARATOR}${normalizedQuery}${CACHE_KEY_SEPARATOR}${searchSignature}`;
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

function attachCallerToSharedRequest<T>(
	request: SharedInFlightRequest<T>,
	signal: AbortSignal | undefined,
	message: string,
): Promise<T> {
	if (signal?.aborted || request.controller.signal.aborted) {
		return Promise.reject(createAbortError(message));
	}

	request.callerCount += 1;

	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let onAbort = () => {};

		const cleanup = (): void => {
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		};

		const settle = (handler: () => void): void => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			releaseSharedRequestCaller(request);
			handler();
		};

		onAbort = () => {
			settle(() => reject(createAbortError(message)));
		};

		if (signal) {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		request.promise.then(
			(value) => {
				if (signal?.aborted) {
					settle(() => reject(createAbortError(message)));
				} else {
					settle(() => resolve(value));
				}
			},
			(error) => {
				if (signal?.aborted && !isAbortError(error)) {
					settle(() => reject(createAbortError(message)));
					return;
				}
				settle(() => reject(error));
			},
		);
	});
}

function releaseSharedRequestCaller<T>(request: SharedInFlightRequest<T>): void {
	request.callerCount = Math.max(request.callerCount - 1, 0);
	if (request.callerCount === 0) {
		request.controller.abort();
	}
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
	searchContext: PreviewSearchContext | undefined,
): number {
	const firstMatchOffset = searchContext?.firstMatchOffset;
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

function getRenderedPreviewCacheEntryForState(
	state: CardPreviewSharedCacheState,
	cacheKey: string,
): RenderedTextPreviewCacheEntry | undefined {
	if (getDebugDisableRenderedPreviewCache()) {
		return undefined;
	}

	return state.renderedPreviewCache.get(cacheKey);
}

function cloneRenderedPreviewContentForState(
	state: CardPreviewSharedCacheState,
	entry: RenderedTextPreviewCacheEntry,
): DocumentFragment {
	let template = state.renderedPreviewTemplates.get(entry);
	if (!template) {
		template = document.createElement("template");
		template.innerHTML = entry.html;
		state.renderedPreviewTemplates.set(entry, template);
	}
	return template.content.cloneNode(true) as DocumentFragment;
}

export function canShareRenderedTextPreview(content: string): boolean {
	return !content.includes("twohop-render-block");
}

async function applySharedSearchContextToTextPreviewForState(
	state: CardPreviewSharedCacheState,
	params: {
		previewContent: string;
		previewContentIdentityKey: string;
		targetFile: TFile;
		normalizedQuery: string;
		searchContext?: PreviewSearchContext | (() => PreviewSearchContext | undefined);
		settings: PreviewRenderSettingsInput;
		vault: Vault;
		signal?: AbortSignal;
	},
): Promise<string> {
	const {
		previewContent,
		previewContentIdentityKey,
		targetFile,
		normalizedQuery,
		searchContext,
		settings,
		vault,
		signal,
	} = params;
	const cacheKey = buildSearchContextCacheKey(
		previewContentIdentityKey,
		normalizedQuery,
		settings,
	);
	const cached = state.searchContextPreviewCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const existingRequest = state.searchContextPreviewInFlight.get(cacheKey);
	if (existingRequest && !existingRequest.controller.signal.aborted) {
		return attachCallerToSharedRequest(
			existingRequest,
			signal,
			"Preview request aborted",
		);
	}
	if (existingRequest) {
		state.searchContextPreviewInFlight.delete(cacheKey);
	}

	const request: SharedInFlightRequest<string> = {
		cacheKey,
		callerCount: 0,
		controller: new AbortController(),
		promise: Promise.resolve(""),
	};
	const sharedSignal = request.controller.signal;
	const buildPromise = (async () => {
		throwIfAborted(sharedSignal, "Preview request aborted");
		let contentForRender = previewContent;
		if (!previewContentHasVisibleQuery(previewContent, normalizedQuery)) {
			const rawContent = await readRawContent(targetFile, vault, sharedSignal);
			throwIfAborted(sharedSignal, "Preview request aborted");

			const resolvedSearchContext =
				typeof searchContext === "function" ? searchContext() : searchContext;
			const firstMatchIndex = resolveFirstMatchIndex(
				rawContent,
				normalizedQuery,
				resolvedSearchContext,
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
	})();

	request.promise = buildPromise;
	state.searchContextPreviewInFlight.set(cacheKey, request);
	void buildPromise.then(
		() => finalizeSharedRequest(state.searchContextPreviewInFlight, request),
		() => finalizeSharedRequest(state.searchContextPreviewInFlight, request),
	);

	return attachCallerToSharedRequest(request, signal, "Preview request aborted");
}

async function getOrCreateRenderedTextPreviewEntryForState(
	state: CardPreviewSharedCacheState,
	params: {
		cacheKey: string;
		content: string;
		app: App;
		sourcePath: string;
		enableMathRendering: boolean;
		analysis?: PreviewContentAnalysis;
		signal?: AbortSignal;
	},
): Promise<RenderedTextPreviewCacheEntry> {
	const {
		cacheKey,
		content,
		app,
		sourcePath,
		enableMathRendering,
		analysis,
		signal,
	} = params;
	if (signal?.aborted) {
		throw createAbortError("Preview render aborted");
	}
	if (!canShareRenderedTextPreview(content)) {
		throw new Error(
			"Rendered text preview contains Obsidian-rendered blocks and cannot be shared",
		);
	}

	if (getDebugDisableRenderedPreviewCache()) {
		return renderTextPreviewEntry({
			content,
			app,
			sourcePath,
			enableMathRendering,
			analysis,
			signal,
		});
	}

	const cached = state.renderedPreviewCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const existingRequest = state.renderedPreviewInFlight.get(cacheKey);
	if (existingRequest && !existingRequest.controller.signal.aborted) {
		return attachCallerToSharedRequest(
			existingRequest,
			signal,
			"Preview render aborted",
		);
	}
	if (existingRequest) {
		state.renderedPreviewInFlight.delete(cacheKey);
	}

	const request: SharedInFlightRequest<RenderedTextPreviewCacheEntry> = {
		cacheKey,
		callerCount: 0,
		controller: new AbortController(),
		promise: Promise.resolve(undefined as never),
	};
	const sharedSignal = request.controller.signal;
	const renderPromise = renderTextPreviewEntry({
		content,
		app,
		sourcePath,
		enableMathRendering,
		analysis,
		signal: sharedSignal,
	}).then((renderedEntry) => {
		state.renderedPreviewCache.set(
			cacheKey,
			renderedEntry,
			renderedEntry.estimatedBytes + stringBytes(cacheKey),
		);
		return renderedEntry;
	});

	request.promise = renderPromise;
	state.renderedPreviewInFlight.set(cacheKey, request);
	void renderPromise.then(
		() => finalizeSharedRequest(state.renderedPreviewInFlight, request),
		() => finalizeSharedRequest(state.renderedPreviewInFlight, request),
	);

	return attachCallerToSharedRequest(request, signal, "Preview render aborted");
}

function finalizeSharedRequest<T>(
	map: Map<string, SharedInFlightRequest<T>>,
	request: SharedInFlightRequest<T>,
): void {
	if (map.get(request.cacheKey) === request) {
		map.delete(request.cacheKey);
	}
}

function renderTextPreviewEntry(params: {
	content: string;
	app: App;
	sourcePath: string;
	enableMathRendering: boolean;
	analysis?: PreviewContentAnalysis;
	signal?: AbortSignal;
}): Promise<RenderedTextPreviewCacheEntry> {
	const { content, app, sourcePath, enableMathRendering, analysis, signal } = params;

	return enqueuePreviewRender(async () => {
		const tempContainer = document.createElement("div");
		const renderComponent = new Component();
		renderComponent.load();

		try {
			throwIfAborted(signal, "Preview render aborted");
			await processPreviewContent(
				tempContainer,
				content,
				app,
				sourcePath,
				renderComponent,
				{
					enableMathRendering,
					analysis,
					syncShadowRootMathStyles: false,
					signal,
				},
			);
			throwIfAborted(signal, "Preview render aborted");

			const html = tempContainer.innerHTML;

			return {
				kind: "text",
				html,
				hasMath: enableMathRendering && analysis?.hasMathExpression === true,
				estimatedBytes: estimateRenderedTextPreviewSize(html),
			};
		} finally {
			renderComponent.unload();
		}
	}, signal);
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
	state.renderedPreviewCache.clear();
	abortSharedRequests(state.renderedPreviewInFlight);
	state.searchContextPreviewCache.clear();
	abortSharedRequests(state.searchContextPreviewInFlight);
	state.previewAnalysisCache.clear();
}

/** Runtime-owned rendered preview, search context, and analysis caches. */
export interface CardPreviewSharedCache {
	getRenderedPreviewCacheEntry(
		cacheKey: string,
	): RenderedTextPreviewCacheEntry | undefined;
	cloneRenderedPreviewContent(entry: RenderedTextPreviewCacheEntry): DocumentFragment;
	applySharedSearchContextToTextPreview(
		params: Parameters<typeof applySharedSearchContextToTextPreviewForState>[1],
	): Promise<string>;
	getOrCreateRenderedTextPreviewEntry(
		params: Parameters<typeof getOrCreateRenderedTextPreviewEntryForState>[1],
	): Promise<RenderedTextPreviewCacheEntry>;
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
		getRenderedPreviewCacheEntry: (cacheKey) =>
			getRenderedPreviewCacheEntryForState(state, cacheKey),
		cloneRenderedPreviewContent: (entry) =>
			cloneRenderedPreviewContentForState(state, entry),
		applySharedSearchContextToTextPreview: (params) =>
			applySharedSearchContextToTextPreviewForState(state, params),
		getOrCreateRenderedTextPreviewEntry: (params) =>
			getOrCreateRenderedTextPreviewEntryForState(state, params),
		getSharedPreviewAnalysis: (cacheKey, content) =>
			getSharedPreviewAnalysisForState(state, cacheKey, content),
		clear: () => clearCacheState(state),
	};
}
