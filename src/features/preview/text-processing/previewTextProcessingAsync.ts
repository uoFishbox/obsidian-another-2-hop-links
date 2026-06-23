import { canvasToSearchText } from "./canvasText";
import {
	findFirstAllowedFencedCodeBlock,
	type CooperativeScanOptions,
	type FencedCodeBlockRange,
} from "./fencedCodeBlocks";
import { extractFirstEmbeddedMedia, type ParsedEmbed } from "./mediaExtractor";
import { getContentSnippet, type GetContentSnippetOptions } from "./snippetExtractor";
import { highlightSearchMatchesInHtml } from "./searchHighlighter";
import { transformContentForPreview } from "./textTransformUtils";
import type { TransformContentForPreviewOptions } from "./types";
import {
	PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH,
	type PreviewTextWorkerResult,
} from "./previewTextWorkerTypes";
import { runPreviewTextWorker } from "./previewTextWorkerClient";
import type { PluginSettings } from "types/settings";

function shouldUsePreviewTextWorker(content: string): boolean {
	return content.length > PREVIEW_TEXT_WORKER_MIN_CONTENT_LENGTH;
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

export async function getContentSnippetAsync(
	content: string,
	settings?: PluginSettings,
	searchQuery?: string,
	searchOptions?: GetContentSnippetOptions,
	signal?: AbortSignal,
): Promise<string> {
	if (!shouldUsePreviewTextWorker(content)) {
		return getContentSnippet(content, settings, searchQuery, searchOptions);
	}

	return await runWithFallback<string>(
		runPreviewTextWorker(
			{
				type: "get-content-snippet",
				content,
				settings,
				searchQuery,
				searchOptions,
			},
			signal,
		),
		() => getContentSnippet(content, settings, searchQuery, searchOptions),
	);
}

export async function transformContentForPreviewAsync(
	content: string,
	settings?: PluginSettings,
	options?: TransformContentForPreviewOptions,
	signal?: AbortSignal,
): Promise<string> {
	if (!shouldUsePreviewTextWorker(content)) {
		return transformContentForPreview(content, settings, options);
	}

	return await runWithFallback<string>(
		runPreviewTextWorker(
			{
				type: "transform-content",
				content,
				settings,
				options,
			},
			signal,
		),
		() => transformContentForPreview(content, settings, options),
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
	if (!shouldUsePreviewTextWorker(content)) {
		return await extractFirstEmbeddedMedia(content, options);
	}

	return await runWithFallback<ParsedEmbed | undefined>(
		runPreviewTextWorker(
			{
				type: "extract-first-embedded-media",
				content,
				maxScanChars: options.maxScanChars,
			},
			options.signal,
		),
		() => extractFirstEmbeddedMedia(content, options),
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

export async function findFirstAllowedFencedCodeBlockAsync(
	content: string,
	allowedTypes: ReadonlySet<string>,
	options: CooperativeScanOptions = {},
	allowedTypesArray: readonly string[],
): Promise<FencedCodeBlockRange | undefined> {
	if (!shouldUsePreviewTextWorker(content)) {
		return await findFirstAllowedFencedCodeBlock(content, allowedTypes, options);
	}

	return await runWithFallback<FencedCodeBlockRange | undefined>(
		runPreviewTextWorker(
			{
				type: "find-first-allowed-fenced-code-block",
				content,
				allowedTypes: allowedTypesArray,
				maxScanChars: options.maxScanChars,
			},
			options.signal,
		),
		() => findFirstAllowedFencedCodeBlock(content, allowedTypes, options),
	);
}
