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

function findHtmlTagEndExclusive(content: string, tagStart: number): number {
	if (tagStart === -1) {
		return -1;
	}

	const tagEnd = content.indexOf(">", tagStart + 1);
	return tagEnd === -1 ? -1 : tagEnd + 1;
}

function highlightMatchesOutsideHtmlTags(
	content: string,
	searchPattern: RegExp,
): string {
	let parts: string[] | undefined;
	let copiedUntil = 0;
	searchPattern.lastIndex = 0;
	let match = searchPattern.exec(content);

	if (!match) {
		return content;
	}

	let tagStart = content.indexOf("<");
	let tagEndExclusive = findHtmlTagEndExclusive(content, tagStart);

	do {
		const matchStart = match.index;
		const matchText = match[0];
		const matchEnd = matchStart + matchText.length;

		while (tagEndExclusive !== -1 && tagEndExclusive <= matchStart) {
			tagStart = content.indexOf("<", tagEndExclusive);
			tagEndExclusive = findHtmlTagEndExclusive(content, tagStart);
		}

		const overlapsHtmlTag =
			tagEndExclusive !== -1 &&
			matchStart < tagEndExclusive &&
			tagStart < matchEnd;

		if (!overlapsHtmlTag) {
			parts ??= [];
			parts.push(
				content.substring(copiedUntil, matchStart),
				`${HIGHLIGHT_OPEN_TAG}${matchText}${HIGHLIGHT_CLOSE_TAG}`,
			);
			copiedUntil = matchEnd;
		}

		match = searchPattern.exec(content);
	} while (match);

	if (!parts) {
		return content;
	}

	parts.push(content.substring(copiedUntil));
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

	return highlightMatchesOutsideHtmlTags(cleanedContent, searchPattern);
}
