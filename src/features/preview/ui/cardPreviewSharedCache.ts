import { Component } from "obsidian";
import type { App, TFile, Vault } from "obsidian";
import { processPreviewContent } from "features/preview/renderers/markdownPreviewRenderer";
import {
	clearPreviewRenderQueue,
	enqueuePreviewRender,
} from "features/preview/renderers/previewRenderQueue";
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
	buildPreviewContentSettingsSignature,
	buildPreviewContentIdentityKey,
	buildRenderCacheKey,
	buildPreviewRenderKeys,
	normalizePreviewQuery,
	CACHE_KEY_SEPARATOR,
	getPreviewSettingsSignatures,
} from "features/preview/core/previewRenderKeys";
import { DEBUG_DISABLE_RENDERED_PREVIEW_CACHE } from "../../../appConstants";
import type { PluginSettings } from "features/settings/model";
import { createSizedLRUCache, stringBytes } from "shared/cache/sizedLRUCache";

export type RenderedPreviewCacheEntry = {
	kind: "text";
	hasMath: boolean;
	template: HTMLTemplateElement;
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

export {
	buildPreviewContentSettingsSignature,
	buildPreviewContentIdentityKey,
	buildRenderCacheKey,
	buildPreviewRenderKeys,
	normalizePreviewQuery,
};

const renderedPreviewCache = createSizedLRUCache<string, RenderedPreviewCacheEntry>(
	RENDERED_PREVIEW_CACHE_MAX_BYTES,
);
const renderedPreviewInFlight = new Map<
	string,
	SharedInFlightRequest<RenderedPreviewCacheEntry>
>();
const searchContextPreviewCache = createSizedLRUCache<string, string>(
	SEARCH_CONTEXT_CACHE_MAX_BYTES,
);
const searchContextPreviewInFlight = new Map<string, SharedInFlightRequest<string>>();
const previewAnalysisCache = createSizedLRUCache<string, PreviewContentAnalysis>(
	PREVIEW_ANALYSIS_CACHE_MAX_BYTES,
);
const EMPTY_PREVIEW_PROTECTED_SEGMENTS: PreviewContentAnalysis["protectedSegments"] =
	[];

function estimateRenderedPreviewSizeFromContent(content: string): number {
	return 1024 + stringBytes(content) * 4;
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
	settings: PluginSettings,
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

function createAbortError(message: string): DOMException {
	return new DOMException(message, "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
	if (signal?.aborted) {
		throw createAbortError(message);
	}
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

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";
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

export function getRenderedPreviewCacheEntry(
	cacheKey: string,
): RenderedPreviewCacheEntry | undefined {
	if (DEBUG_DISABLE_RENDERED_PREVIEW_CACHE) {
		return undefined;
	}

	return renderedPreviewCache.get(cacheKey);
}

export function cloneRenderedPreviewContent(
	entry: RenderedPreviewCacheEntry,
): DocumentFragment {
	return entry.template.content.cloneNode(true) as DocumentFragment;
}

export function canShareRenderedTextPreview(content: string): boolean {
	return !content.includes("twohop-render-block");
}

export async function applySharedSearchContextToTextPreview(params: {
	previewContent: string;
	previewContentIdentityKey: string;
	targetFile: TFile;
	normalizedQuery: string;
	searchContext?: PreviewSearchContext | (() => PreviewSearchContext | undefined);
	settings: PluginSettings;
	vault: Vault;
	signal?: AbortSignal;
}): Promise<string> {
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
	const cached = searchContextPreviewCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const existingRequest = searchContextPreviewInFlight.get(cacheKey);
	if (existingRequest && !existingRequest.controller.signal.aborted) {
		return attachCallerToSharedRequest(
			existingRequest,
			signal,
			"Preview request aborted",
		);
	}
	if (existingRequest) {
		searchContextPreviewInFlight.delete(cacheKey);
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
		searchContextPreviewCache.set(
			cacheKey,
			highlightedContent,
			stringBytes(highlightedContent),
		);
		return highlightedContent;
	})();

	request.promise = buildPromise;
	searchContextPreviewInFlight.set(cacheKey, request);
	buildPromise.then(
		() => searchContextPreviewInFlight.delete(cacheKey),
		() => searchContextPreviewInFlight.delete(cacheKey),
	);

	return attachCallerToSharedRequest(request, signal, "Preview request aborted");
}

export async function getOrCreateRenderedTextPreviewEntry(params: {
	cacheKey: string;
	content: string;
	app: App;
	sourcePath: string;
	enableMathRendering: boolean;
	analysis?: PreviewContentAnalysis;
	signal?: AbortSignal;
}): Promise<RenderedPreviewCacheEntry> {
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
		throw new DOMException("Preview render aborted", "AbortError");
	}
	if (!canShareRenderedTextPreview(content)) {
		throw new Error(
			"Rendered text preview contains Obsidian-rendered blocks and cannot be shared",
		);
	}

	if (DEBUG_DISABLE_RENDERED_PREVIEW_CACHE) {
		return renderTextPreviewEntry({
			content,
			app,
			sourcePath,
			enableMathRendering,
			analysis,
			signal,
		});
	}

	const cached = renderedPreviewCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const existingRequest = renderedPreviewInFlight.get(cacheKey);
	if (existingRequest && !existingRequest.controller.signal.aborted) {
		return attachCallerToSharedRequest(
			existingRequest,
			signal,
			"Preview render aborted",
		);
	}
	if (existingRequest) {
		renderedPreviewInFlight.delete(cacheKey);
	}

	const request: SharedInFlightRequest<RenderedPreviewCacheEntry> = {
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
		renderedPreviewCache.set(
			cacheKey,
			renderedEntry,
			estimateRenderedPreviewSizeFromContent(content),
		);
		return renderedEntry;
	});

	request.promise = renderPromise;
	renderedPreviewInFlight.set(cacheKey, request);
	renderPromise.then(
		() => renderedPreviewInFlight.delete(cacheKey),
		() => renderedPreviewInFlight.delete(cacheKey),
	);

	return attachCallerToSharedRequest(request, signal, "Preview render aborted");
}

function renderTextPreviewEntry(params: {
	content: string;
	app: App;
	sourcePath: string;
	enableMathRendering: boolean;
	analysis?: PreviewContentAnalysis;
	signal?: AbortSignal;
}): Promise<RenderedPreviewCacheEntry> {
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

			const template = document.createElement("template");
			while (tempContainer.firstChild) {
				template.content.appendChild(tempContainer.firstChild);
			}

			return {
				kind: "text",
				hasMath: enableMathRendering && analysis?.hasMathExpression === true,
				template,
			};
		} finally {
			renderComponent.unload();
		}
	}, signal);
}

export function getSharedPreviewAnalysis(
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

	const cached = previewAnalysisCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const analysis = analyzePreviewContent(content);
	previewAnalysisCache.set(cacheKey, analysis, estimatePreviewAnalysisSize(analysis));
	return analysis;
}

// Used by tests to isolate module-scope caches.
export function clearCardPreviewSharedCaches(): void {
	renderedPreviewCache.clear();
	abortSharedRequests(renderedPreviewInFlight);
	clearPreviewRenderQueue();
	searchContextPreviewCache.clear();
	abortSharedRequests(searchContextPreviewInFlight);
	previewAnalysisCache.clear();
}
