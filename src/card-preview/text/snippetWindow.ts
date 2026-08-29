import {
	findFencedCodeBlockContainingOffset,
	type FencedCodeBlockRange,
} from "./fencedCodeBlocks";
import {
	SEARCH_PREVIEW_SEEK_BUFFER_CHARS,
	SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS,
} from "../pipeline/previewRenderSettings";
import { stripLeadingFrontmatter } from "./frontmatterUtils";
import { findCaseInsensitiveIndex } from "./searchUtils";
import type { GetContentSnippetOptions, PreviewSnippetSettings } from "./types";

/** Selected raw Markdown window and its omission metadata. */
export interface ContentSnippetWindow {
	readonly contentToProcess: string;
	readonly hasLeadingOmission: boolean;
	readonly hasTrailingOmission: boolean;
}

const DEFAULT_PREVIEW_MAX_CHARS = 300;
const DEFAULT_SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS = 300;
const DEFAULT_SEARCH_PREVIEW_SEEK_BUFFER_CHARS = 30;
const RAW_WINDOW_SIZE_MULTIPLIER = 4;
const MIN_RAW_WINDOW_SIZE = 2500;

function resolveSearchPreviewSeekThresholdChars(
	settings: PreviewSnippetSettings | undefined,
): number {
	return settings
		? SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS
		: DEFAULT_SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS;
}

function resolveSearchPreviewSeekBufferChars(
	settings: PreviewSnippetSettings | undefined,
): number {
	return settings
		? SEARCH_PREVIEW_SEEK_BUFFER_CHARS
		: DEFAULT_SEARCH_PREVIEW_SEEK_BUFFER_CHARS;
}

function resolveFirstMatchIndexAfterFrontmatter(
	effectiveContent: string,
	removedLength: number,
	normalizedSearchQuery: string,
	searchOptions?: GetContentSnippetOptions,
): number {
	const firstMatchIndex = searchOptions?.firstMatchIndex;
	if (typeof firstMatchIndex !== "number") {
		return findCaseInsensitiveIndex(effectiveContent, normalizedSearchQuery);
	}

	if (firstMatchIndex >= removedLength) {
		return firstMatchIndex - removedLength;
	}

	return findCaseInsensitiveIndex(effectiveContent, normalizedSearchQuery);
}

function buildFencedBlockSliceAroundMatch(
	content: string,
	block: FencedCodeBlockRange,
	firstMatchIndex: number,
	searchQueryLength: number,
	windowSize: number,
	searchSeekBufferChars: number,
	shouldSeekByThreshold: boolean,
): ContentSnippetWindow {
	const codeLength = block.contentEnd - block.contentStart;
	const matchOffsetInCode = Math.max(
		0,
		Math.min(codeLength, firstMatchIndex - block.contentStart),
	);
	const header = `${block.fence}${block.infoString}\n`;
	const footer = `\n${block.fence}`;
	const visibleInfoString =
		firstMatchIndex < block.contentStart ? block.infoString.trim() : "";
	const visibleInfoPrefix = visibleInfoString ? `${visibleInfoString}\n` : "";
	const codeWindowSize = Math.max(
		searchQueryLength,
		windowSize - header.length - footer.length - visibleInfoPrefix.length,
	);
	const centeredPadding = Math.max(
		0,
		Math.floor((codeWindowSize - searchQueryLength) / 2),
	);

	let leadingChars = Math.min(matchOffsetInCode, centeredPadding);
	if (shouldSeekByThreshold) {
		leadingChars = Math.min(leadingChars, searchSeekBufferChars);
	}

	const bodySliceStart = Math.max(0, matchOffsetInCode - leadingChars);
	const bodySliceEnd = Math.min(codeLength, bodySliceStart + codeWindowSize);
	const absoluteBodySliceStart = block.contentStart + bodySliceStart;
	const absoluteBodySliceEnd = block.contentStart + bodySliceEnd;

	let slicedCodeBody = content.substring(
		absoluteBodySliceStart,
		absoluteBodySliceEnd,
	);
	const leadingOmission = bodySliceStart > 0;
	const trailingOmission = bodySliceEnd < codeLength;
	if (leadingOmission || trailingOmission) {
		slicedCodeBody =
			(leadingOmission ? "..." : "") +
			slicedCodeBody +
			(trailingOmission ? "..." : "");
	}
	slicedCodeBody = visibleInfoPrefix + slicedCodeBody;

	const fencedCodeSlice = `${header}${slicedCodeBody}${footer}`;
	const hasFollowingContent = block.blockEnd < content.length;
	const trailingSeparator = hasFollowingContent ? "\n" : "";
	const trailingWindowSize = Math.max(
		0,
		windowSize - fencedCodeSlice.length - trailingSeparator.length,
	);
	const trailingSliceEnd = Math.min(
		content.length,
		block.blockEnd + trailingWindowSize,
	);
	const trailingContent =
		trailingSliceEnd > block.blockEnd
			? trailingSeparator + content.substring(block.blockEnd, trailingSliceEnd)
			: "";

	return {
		contentToProcess: fencedCodeSlice + trailingContent,
		hasLeadingOmission: block.blockStart > 0 || leadingOmission,
		hasTrailingOmission: trailingOmission || trailingSliceEnd < content.length,
	};
}

function getLeadingCharsWithinLineLimit(
	content: string,
	firstMatchIndex: number,
	maxLines: number,
): number {
	if (!Number.isFinite(maxLines)) return firstMatchIndex;

	const lineBreaksToFind = Math.max(1, Math.floor(maxLines));
	let lineStart = firstMatchIndex;

	for (let count = 0; count < lineBreaksToFind; count++) {
		// String#lastIndexOf clamps a negative start position to zero.
		if (lineStart === 0) return firstMatchIndex;

		const lineBreakIndex = content.lastIndexOf("\n", lineStart - 1);
		if (lineBreakIndex === -1) return firstMatchIndex;
		lineStart = lineBreakIndex;
	}

	return firstMatchIndex - (lineStart + 1);
}

function selectContentSlice(
	content: string,
	rawWindowLimit: number,
	settings: PreviewSnippetSettings | undefined,
	normalizedSearchQuery: string,
	precomputedFirstMatchIndex?: number,
): ContentSnippetWindow {
	const hasRawWindowOverflow = content.length > rawWindowLimit;
	const hasPreviewTruncationLimit =
		(settings?.previewMaxChars ?? 0) > 0 || (settings?.previewMaxLines ?? 0) > 0;

	if (!normalizedSearchQuery) {
		return {
			contentToProcess: hasRawWindowOverflow
				? content.substring(0, rawWindowLimit)
				: content,
			hasLeadingOmission: false,
			hasTrailingOmission: false,
		};
	}

	const firstMatchIndex =
		typeof precomputedFirstMatchIndex === "number"
			? precomputedFirstMatchIndex
			: findCaseInsensitiveIndex(content, normalizedSearchQuery);

	if (firstMatchIndex === -1) {
		return {
			contentToProcess: content.substring(0, rawWindowLimit),
			hasLeadingOmission: false,
			hasTrailingOmission: false,
		};
	}

	const searchSeekThresholdChars = resolveSearchPreviewSeekThresholdChars(settings);
	const searchSeekBufferChars = resolveSearchPreviewSeekBufferChars(settings);
	const shouldSeekByThreshold = firstMatchIndex > searchSeekThresholdChars;

	if (!hasRawWindowOverflow && !hasPreviewTruncationLimit && !shouldSeekByThreshold) {
		return {
			contentToProcess: content,
			hasLeadingOmission: false,
			hasTrailingOmission: false,
		};
	}

	const windowSize = Math.max(rawWindowLimit, normalizedSearchQuery.length);
	const centeredPadding = Math.max(
		0,
		Math.floor((windowSize - normalizedSearchQuery.length) / 2),
	);

	let maxLeadingChars = firstMatchIndex;
	if (settings?.previewMaxChars && settings.previewMaxChars > 0) {
		// Truncation starts at the beginning, so keep the first match inside
		// the guaranteed visible range.
		const guaranteedLeadingChars = Math.max(
			settings.previewMaxChars - normalizedSearchQuery.length,
			0,
		);
		maxLeadingChars = Math.min(maxLeadingChars, guaranteedLeadingChars);
	}

	if (settings?.previewMaxLines && settings.previewMaxLines > 0) {
		maxLeadingChars = Math.min(
			maxLeadingChars,
			getLeadingCharsWithinLineLimit(
				content,
				firstMatchIndex,
				settings.previewMaxLines,
			),
		);
	}

	if (shouldSeekByThreshold) {
		maxLeadingChars = Math.min(maxLeadingChars, searchSeekBufferChars);
	}

	const sidePadding = Math.min(centeredPadding, maxLeadingChars);
	const sliceStart = Math.max(0, firstMatchIndex - sidePadding);
	const sliceEnd = Math.min(content.length, sliceStart + windowSize);

	const enclosingFencedBlock = findFencedCodeBlockContainingOffset(
		content,
		firstMatchIndex,
	);
	if (enclosingFencedBlock) {
		const matchIsInOpeningFence =
			firstMatchIndex < enclosingFencedBlock.contentStart;
		const cutsFenceBoundary =
			sliceStart > enclosingFencedBlock.blockStart ||
			sliceEnd < enclosingFencedBlock.blockEnd;
		if (matchIsInOpeningFence || cutsFenceBoundary) {
			return buildFencedBlockSliceAroundMatch(
				content,
				enclosingFencedBlock,
				firstMatchIndex,
				normalizedSearchQuery.length,
				windowSize,
				searchSeekBufferChars,
				shouldSeekByThreshold,
			);
		}
	}

	return {
		contentToProcess: content.substring(sliceStart, sliceEnd),
		hasLeadingOmission: sliceStart > 0,
		hasTrailingOmission: sliceEnd < content.length,
	};
}

/** Selects the smallest raw Markdown window needed to render a snippet. */
export function selectContentSnippetWindow(
	content: string,
	settings: PreviewSnippetSettings | undefined,
	normalizedSearchQuery: string,
	searchOptions?: GetContentSnippetOptions,
): ContentSnippetWindow {
	const strippedFrontmatter = stripLeadingFrontmatter(content);
	const effectiveContent = strippedFrontmatter.content;
	const firstMatchIndex =
		normalizedSearchQuery && strippedFrontmatter.removed
			? resolveFirstMatchIndexAfterFrontmatter(
					effectiveContent,
					strippedFrontmatter.removedLength,
					normalizedSearchQuery,
					searchOptions,
				)
			: searchOptions?.firstMatchIndex;
	const configuredMaxChars = settings?.previewMaxChars ?? DEFAULT_PREVIEW_MAX_CHARS;
	const rawWindowLimit = Math.max(
		configuredMaxChars * RAW_WINDOW_SIZE_MULTIPLIER,
		MIN_RAW_WINDOW_SIZE,
	);

	return selectContentSlice(
		effectiveContent,
		rawWindowLimit,
		settings,
		normalizedSearchQuery,
		firstMatchIndex,
	);
}
