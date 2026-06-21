import { escapeHtml } from "./protectedHtml";
import { createCaseInsensitiveRegExp } from "./searchUtils";

function wrapMatchesWithHighlight(
	text: string,
	searchPattern: RegExp | null,
	escapeSegments: boolean,
): string {
	if (!searchPattern) {
		return escapeSegments ? escapeHtml(text) : text;
	}

	searchPattern.lastIndex = 0;
	let cursor = 0;
	let match = searchPattern.exec(text);
	if (!match) {
		return escapeSegments ? escapeHtml(text) : text;
	}

	const parts: string[] = [];
	do {
		const matchIndex = match.index;
		const matchText = match[0];

		const prefix = text.substring(cursor, matchIndex);

		parts.push(escapeSegments ? escapeHtml(prefix) : prefix);
		parts.push(`<span class="ccl-search-highlight">${
			escapeSegments ? escapeHtml(matchText) : matchText
		}</span>`);

		cursor = matchIndex + matchText.length;
		match = searchPattern.exec(text);
	} while (match);

	const suffix = text.substring(cursor);
	parts.push(escapeSegments ? escapeHtml(suffix) : suffix);

	return parts.join("");
}

function stripCmHighlightSpans(content: string): string {
	return content.replace(
		/<span\s+class="ccl-search-highlight">([\s\S]*?)<\/span>/gi,
		"$1",
	);
}

function highlightTextSegmentsInHtmlByVisibleRange(
	content: string,
	searchPattern: RegExp,
): string {
	const parts: string[] = [];
	let cursor = 0;

	while (cursor < content.length) {
		const tagStart = content.indexOf("<", cursor);
		if (tagStart === -1) {
			parts.push(
				wrapMatchesWithHighlight(
					content.substring(cursor),
					searchPattern,
					false,
				),
			);
			break;
		}

		const tagEnd = content.indexOf(">", tagStart + 1);
		if (tagEnd === -1) {
			parts.push(
				wrapMatchesWithHighlight(
					content.substring(cursor),
					searchPattern,
					false,
				),
			);
			break;
		}

		if (tagStart > cursor) {
			parts.push(
				wrapMatchesWithHighlight(
					content.substring(cursor, tagStart),
					searchPattern,
					false,
				),
			);
		}

		parts.push(content.substring(tagStart, tagEnd + 1));
		cursor = tagEnd + 1;
	}

	return parts.join("");
}

function highlightTextSegmentsInHtml(
	content: string,
	searchPattern: RegExp,
): string {
	// A literal "<" can cross an HTML boundary when matching against the
	// original string. Keep that rare case scoped to each visible range.
	if (searchPattern.source.includes("<")) {
		return highlightTextSegmentsInHtmlByVisibleRange(content, searchPattern);
	}

	let parts: string[] | undefined;
	let cursor = 0;
	let copiedUntil = 0;
	searchPattern.lastIndex = 0;
	let match = searchPattern.exec(content);

	if (!match) {
		return content;
	}

	const appendHighlightedRange = (start: number, end: number): void => {
		while (match && match.index < start) {
			match = searchPattern.exec(content);
		}

		while (match && match.index < end) {
			const matchIndex = match.index;
			const matchText = match[0];
			const matchEnd = matchIndex + matchText.length;

			if (matchEnd <= end) {
				parts ??= [];
				parts.push(
					content.substring(copiedUntil, matchIndex),
					`<span class="ccl-search-highlight">${matchText}</span>`,
				);
				copiedUntil = matchEnd;
			}

			match = searchPattern.exec(content);
		}
	};

	while (cursor < content.length) {
		const tagStart = content.indexOf("<", cursor);
		if (tagStart === -1) {
			appendHighlightedRange(cursor, content.length);
			break;
		}

		const tagEnd = content.indexOf(">", tagStart + 1);
		if (tagEnd === -1) {
			appendHighlightedRange(cursor, content.length);
			break;
		}

		if (tagStart > cursor) {
			appendHighlightedRange(cursor, tagStart);
		}

		cursor = tagEnd + 1;
	}

	if (!parts) {
		return content;
	}

	parts.push(content.substring(copiedUntil));
	return parts.join("");
}

export function highlightTextForSearch(
	text: string,
	searchQuery?: string,
): string {
	const searchPattern = createCaseInsensitiveRegExp(searchQuery, true);
	return wrapMatchesWithHighlight(text, searchPattern, true);
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

	return highlightTextSegmentsInHtml(cleanedContent, searchPattern);
}
