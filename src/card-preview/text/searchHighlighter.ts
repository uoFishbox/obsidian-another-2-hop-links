import { escapeHtml } from "./protectedHtml";
import { createCaseInsensitiveRegExp } from "./searchUtils";

const HIGHLIGHT_OPEN_TAG = '<span class="ccl-search-highlight">';
const HIGHLIGHT_CLOSE_TAG = "</span>";
const EXISTING_HIGHLIGHT_PATTERN =
	/<span\s+class="ccl-search-highlight">([\s\S]*?)<\/span>/gi;

function highlightEscapedText(text: string, searchPattern: RegExp | null): string {
	if (!searchPattern) {
		return escapeHtml(text);
	}

	searchPattern.lastIndex = 0;
	let cursor = 0;
	let match = searchPattern.exec(text);
	if (!match) {
		return escapeHtml(text);
	}

	const parts: string[] = [];
	do {
		const matchIndex = match.index;
		const matchText = match[0];

		const prefix = text.substring(cursor, matchIndex);

		parts.push(escapeHtml(prefix));
		parts.push(
			`${HIGHLIGHT_OPEN_TAG}${escapeHtml(matchText)}${HIGHLIGHT_CLOSE_TAG}`,
		);

		cursor = matchIndex + matchText.length;
		match = searchPattern.exec(text);
	} while (match);

	const suffix = text.substring(cursor);
	parts.push(escapeHtml(suffix));

	return parts.join("");
}

function stripCmHighlightSpans(content: string): string {
	return content.replace(EXISTING_HIGHLIGHT_PATTERN, "$1");
}

interface VisibleTextSegment {
	readonly sourceStart: number;
	readonly sourceEnd: number;
	readonly textStart: number;
	readonly textEnd: number;
}

function collectVisibleTextSegments(content: string): {
	readonly text: string;
	readonly segments: readonly VisibleTextSegment[];
} {
	const textParts: string[] = [];
	const segments: VisibleTextSegment[] = [];
	let textLength = 0;
	let cursor = 0;
	let tagStart = content.indexOf("<");

	while (tagStart !== -1) {
		const tagEnd = content.indexOf(">", tagStart + 1);
		if (tagEnd === -1) break;
		if (tagStart > cursor) {
			const text = content.substring(cursor, tagStart);
			textParts.push(text);
			segments.push({
				sourceStart: cursor,
				sourceEnd: tagStart,
				textStart: textLength,
				textEnd: textLength + text.length,
			});
			textLength += text.length;
		}
		cursor = tagEnd + 1;
		tagStart = content.indexOf("<", cursor);
	}

	if (cursor < content.length) {
		const text = content.substring(cursor);
		textParts.push(text);
		segments.push({
			sourceStart: cursor,
			sourceEnd: content.length,
			textStart: textLength,
			textEnd: textLength + text.length,
		});
	}

	return { text: textParts.join(""), segments };
}

function highlightVisibleTextMatches(content: string, searchPattern: RegExp): string {
	const visible = collectVisibleTextSegments(content);
	const sourceRanges: Array<{ readonly start: number; readonly end: number }> = [];
	let segmentIndex = 0;
	searchPattern.lastIndex = 0;
	let match = searchPattern.exec(visible.text);

	while (match) {
		const matchStart = match.index;
		const matchEnd = matchStart + match[0].length;
		while (
			segmentIndex < visible.segments.length &&
			visible.segments[segmentIndex].textEnd <= matchStart
		) {
			segmentIndex += 1;
		}

		for (
			let index = segmentIndex;
			index < visible.segments.length &&
			visible.segments[index].textStart < matchEnd;
			index += 1
		) {
			const segment = visible.segments[index];
			const textStart = Math.max(matchStart, segment.textStart);
			const textEnd = Math.min(matchEnd, segment.textEnd);
			if (textStart >= textEnd) continue;
			sourceRanges.push({
				start: segment.sourceStart + textStart - segment.textStart,
				end: segment.sourceStart + textEnd - segment.textStart,
			});
		}

		match = searchPattern.exec(visible.text);
	}

	if (sourceRanges.length === 0) return content;

	const parts: string[] = [];
	let cursor = 0;
	for (const range of sourceRanges) {
		parts.push(
			content.substring(cursor, range.start),
			HIGHLIGHT_OPEN_TAG,
			content.substring(range.start, range.end),
			HIGHLIGHT_CLOSE_TAG,
		);
		cursor = range.end;
	}
	parts.push(content.substring(cursor));
	return parts.join("");
}

export function highlightTextForSearch(text: string, searchQuery?: string): string {
	const searchPattern = createCaseInsensitiveRegExp(searchQuery, true);
	return highlightEscapedText(text, searchPattern);
}

export function highlightSearchMatchesInHtml(
	content: string,
	searchQuery?: string,
): string {
	const cleanedContent = content.includes('class="ccl-search-highlight"')
		? stripCmHighlightSpans(content)
		: content;
	const searchPattern = createCaseInsensitiveRegExp(searchQuery, true);
	if (!searchPattern) {
		return cleanedContent;
	}

	return highlightVisibleTextMatches(cleanedContent, searchPattern);
}
