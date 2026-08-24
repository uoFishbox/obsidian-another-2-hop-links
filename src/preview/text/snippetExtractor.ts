import { selectContentSnippetWindow } from "./snippetWindow";
import { transformContentForPreview } from "./textTransformUtils";
import type {
	GetContentSnippetOptions,
	PreparedContentSnippet,
	PreviewSnippetSettings,
	TextTransformContext,
} from "./types";
import {
	truncatePreviewContent,
	type TruncationResult,
} from "./visualSnippetTruncator";

export type {
	GetContentSnippetOptions,
	PreparedContentSnippet,
	PreviewSnippetSettings,
} from "./types";

/** Normalizes a search query for snippet selection. */
export function normalizeSearchQuery(searchQuery?: string): string {
	return searchQuery?.trim().toLowerCase() ?? "";
}

function buildFallbackSnippetFromRawContent(
	contentToProcess: string,
	settings: PreviewSnippetSettings,
	context: TextTransformContext,
): TruncationResult {
	const rawTruncation = truncatePreviewContent(contentToProcess, settings);
	const rawContent = rawTruncation.content.trim();

	if (!rawContent) {
		return { content: "", truncated: rawTruncation.truncated };
	}

	const transformedContent = transformContentForPreview(rawContent, {
		context,
		skipFrontmatterRemoval: true,
	})
		.replace(/^\n+/, "")
		.trim();

	return {
		content: transformedContent,
		truncated: rawTruncation.truncated,
	};
}

/** Resolves the smallest raw Markdown range needed to build a preview snippet. */
export function prepareContentSnippet(
	content: string,
	settings?: PreviewSnippetSettings,
	searchQuery?: string,
	searchOptions?: GetContentSnippetOptions,
): PreparedContentSnippet {
	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
	const context: TextTransformContext = normalizedSearchQuery
		? "searchSnippet"
		: "preview";
	const contentWindow = selectContentSnippetWindow(
		content,
		settings,
		normalizedSearchQuery,
		searchOptions,
	);

	return {
		contentToProcess: contentWindow.contentToProcess,
		context,
		hasLeadingOmission: contentWindow.hasLeadingOmission,
		hasTrailingOmission: contentWindow.hasTrailingOmission,
	};
}

/** Converts a prepared Markdown range into the final HTML preview snippet. */
export function renderPreparedContentSnippet(
	prepared: PreparedContentSnippet,
	settings?: PreviewSnippetSettings,
): string {
	const processedContent = transformContentForPreview(prepared.contentToProcess, {
		context: prepared.context,
		skipFrontmatterRemoval: true,
	}).replace(/^[\r\n]+/, "");

	if (!settings || (settings.previewMaxLines <= 0 && settings.previewMaxChars <= 0)) {
		return processedContent;
	}

	const truncation = truncatePreviewContent(processedContent, settings);
	let trimmedContent = truncation.content.trim();
	let truncated = truncation.truncated;

	// A transformed code block can start with tags that rewind truncation to zero.
	// Truncate the raw Markdown first and transform it again in that case.
	if (!trimmedContent) {
		const fallback = buildFallbackSnippetFromRawContent(
			prepared.contentToProcess,
			settings,
			prepared.context,
		);
		trimmedContent = fallback.content;
		truncated = truncated || fallback.truncated;
	}

	if (!trimmedContent) return "";

	let finalContent = trimmedContent;
	if (prepared.hasLeadingOmission) finalContent = "..." + finalContent;
	if (truncated || prepared.hasTrailingOmission) finalContent += "...";

	return finalContent;
}

/** Builds a preview snippet from raw Markdown content. */
export function getContentSnippet(
	content: string,
	settings?: PreviewSnippetSettings,
	searchQuery?: string,
	searchOptions?: GetContentSnippetOptions,
): string {
	const prepared = prepareContentSnippet(
		content,
		settings,
		searchQuery,
		searchOptions,
	);
	return renderPreparedContentSnippet(prepared, settings);
}
