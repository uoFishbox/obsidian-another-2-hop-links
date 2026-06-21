export interface ProtectedSegment {
	token: string;
	html: string;
}

const PROTECTED_TOKEN_PREFIX = "\uE0002h";
const PROTECTED_TOKEN_SUFFIX = "\uE001";
const PROTECTED_TOKEN_PATTERN = /\uE0002h([0-9a-z]+)\uE001/g;
const IDENTITY_RESTORER = (content: string): string => content;

export function buildProtectedSegmentToken(index: number): string {
	return `${PROTECTED_TOKEN_PREFIX}${index.toString(36)}${PROTECTED_TOKEN_SUFFIX}`;
}

export function restoreProtectedSegments(
	content: string,
	segments: readonly ProtectedSegment[],
): string {
	if (segments.length === 0) {
		return content;
	}

	PROTECTED_TOKEN_PATTERN.lastIndex = 0;
	return content.replace(PROTECTED_TOKEN_PATTERN, (token, encodedIndex: string) =>
		resolveProtectedSegmentHtml(token, encodedIndex, segments),
	);
}

export function createProtectedSegmentRestorer(
	segments: ProtectedSegment[],
): (content: string) => string {
	if (segments.length === 0) {
		return IDENTITY_RESTORER;
	}

	return (content: string) => restoreProtectedSegments(content, segments);
}

function resolveProtectedSegmentHtml(
	token: string,
	encodedIndex: string,
	segments: readonly ProtectedSegment[],
): string {
	const index = Number.parseInt(encodedIndex, 36);
	const indexedSegment = segments[index];
	if (indexedSegment?.token === token) {
		return indexedSegment.html;
	}

	for (const segment of segments) {
		if (segment.token === token) {
			return segment.html;
		}
	}

	return token;
}

const HTML_ESCAPE_TEST_PATTERN = /[&<>"']/;
const HTML_ESCAPE_PATTERN = /[&<>"']/g;

function replaceHtmlCharacter(char: string): string {
	switch (char) {
		case "&":
			return "&amp;";
		case "<":
			return "&lt;";
		case ">":
			return "&gt;";
		case '"':
			return "&quot;";
		case "'":
			return "&#039;";
		default:
			return char;
	}
}

export function escapeHtml(unsafe: string): string {
	if (!HTML_ESCAPE_TEST_PATTERN.test(unsafe)) {
		return unsafe;
	}

	return unsafe.replace(HTML_ESCAPE_PATTERN, replaceHtmlCharacter);
}
