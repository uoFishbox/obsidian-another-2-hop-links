import { canvasToSearchText } from "./canvasText";
import type { CooperativeScanOptions } from "./fencedCodeBlocks";
import {
	extractFirstEmbeddedMedia,
	selectEmbeddedMediaScanContent,
	type ParsedEmbed,
} from "./mediaExtractor";
import {
	getContentSnippet,
	normalizeSearchQuery,
	prepareContentSnippet,
	renderPreparedContentSnippet,
	type GetContentSnippetOptions,
	type PreviewSnippetSettings,
} from "./snippetExtractor";
import { highlightSearchMatchesInHtml } from "./searchHighlighter";
import {
	PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH,
	type PreviewTextWorkerResult,
} from "./previewTextWorkerTypes";
import { runPreviewTextWorker } from "./previewTextWorkerClient";

function shouldUsePreviewTextWorker(content: string): boolean {
	return content.length > PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH;
}

function selectPreviewSnippetSettings(
	settings: PreviewSnippetSettings | undefined,
): PreviewSnippetSettings | undefined {
	if (!settings) {
		return undefined;
	}

	return {
		cardWidthPx: settings.cardWidthPx,
		cardHeightRatio: settings.cardHeightRatio,
		previewMaxLines: settings.previewMaxLines,
		previewMaxChars: settings.previewMaxChars,
		previewVisualLineSafetyMargin: settings.previewVisualLineSafetyMargin,
		searchPreviewSeekThresholdChars: settings.searchPreviewSeekThresholdChars,
		searchPreviewSeekBufferChars: settings.searchPreviewSeekBufferChars,
	};
}

async function runWithFallback<T>(
	workerPromise: Promise<PreviewTextWorkerResult> | undefined,
	fallback: () => T | Promise<T>,
): Promise<T> {
	if (!workerPromise) {
		return await fallback();
	}

	try {
		return (await workerPromise) as T;
	} catch (error) {
		if (
			typeof DOMException !== "undefined" &&
			error instanceof DOMException &&
			error.name === "AbortError"
		) {
			throw error;
		}
		if (error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		return await fallback();
	}
}

function shouldRunContentSnippetWorker(
	content: string,
	normalizedSearchQuery: string,
): boolean {
	return normalizedSearchQuery !== "" && shouldUsePreviewTextWorker(content);
}

export async function getContentSnippetAsync(
	content: string,
	settings?: PreviewSnippetSettings,
	searchQuery?: string,
	searchOptions?: GetContentSnippetOptions,
	signal?: AbortSignal,
): Promise<string> {
	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);

	if (shouldRunContentSnippetWorker(content, normalizedSearchQuery)) {
		return await runWithFallback<string>(
			runPreviewTextWorker(
				{
					type: "get-content-snippet",
					content,
					settings: selectPreviewSnippetSettings(settings),
					searchQuery,
					searchOptions,
				},
				signal,
			),
			() => getContentSnippet(content, settings, searchQuery, searchOptions),
		);
	}

	const prepared = prepareContentSnippet(
		content,
		settings,
		searchQuery,
		searchOptions,
	);

	if (!shouldUsePreviewTextWorker(prepared.contentToProcess)) {
		return renderPreparedContentSnippet(prepared, settings);
	}

	return await runWithFallback<string>(
		runPreviewTextWorker(
			{
				type: "render-prepared-content-snippet",
				prepared,
				settings: selectPreviewSnippetSettings(settings),
			},
			signal,
		),
		() => renderPreparedContentSnippet(prepared, settings),
	);
}

export async function highlightSearchMatchesInHtmlAsync(
	content: string,
	searchQuery?: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!shouldUsePreviewTextWorker(content)) {
		return highlightSearchMatchesInHtml(content, searchQuery);
	}

	return await runWithFallback<string>(
		runPreviewTextWorker(
			{
				type: "highlight-html",
				content,
				searchQuery,
			},
			signal,
		),
		() => highlightSearchMatchesInHtml(content, searchQuery),
	);
}

export async function extractFirstEmbeddedMediaAsync(
	content: string,
	options: CooperativeScanOptions = {},
): Promise<ParsedEmbed | undefined> {
	const scanContent = selectEmbeddedMediaScanContent(content, options.maxScanChars);
	if (!scanContent) {
		return undefined;
	}

	if (!shouldUsePreviewTextWorker(scanContent)) {
		return await extractFirstEmbeddedMedia(scanContent, options);
	}

	return await runWithFallback<ParsedEmbed | undefined>(
		runPreviewTextWorker(
			{
				type: "extract-first-embedded-media",
				content: scanContent,
				maxScanChars: scanContent.length,
			},
			options.signal,
		),
		() => extractFirstEmbeddedMedia(scanContent, options),
	);
}

export async function canvasToSearchTextAsync(
	input: string | unknown,
	signal?: AbortSignal,
): Promise<ReturnType<typeof canvasToSearchText>> {
	const contentLength = typeof input === "string" ? input.length : 0;
	if (contentLength <= PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH) {
		return canvasToSearchText(input);
	}

	return await runWithFallback<ReturnType<typeof canvasToSearchText>>(
		runPreviewTextWorker(
			{
				type: "canvas-to-search-text",
				input,
			},
			signal,
		),
		() => canvasToSearchText(input),
	);
}
