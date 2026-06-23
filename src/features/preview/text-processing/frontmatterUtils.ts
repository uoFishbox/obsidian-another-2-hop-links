export interface StripFrontmatterResult {
	content: string;
	removedLength: number;
	removed: boolean;
}

const BOM = "\uFEFF";

function getLineBreakLength(text: string, index: number): number {
	if (index >= text.length) {
		return 0;
	}

	if (text[index] === "\n") {
		return 1;
	}

	if (text[index] === "\r" && text[index + 1] === "\n") {
		return 2;
	}

	return 0;
}

function isFrontmatterDelimiterLine(text: string, start: number, end: number): boolean {
	const contentEnd = end > start && text[end - 1] === "\r" ? end - 1 : end;
	return (
		contentEnd - start === 3 &&
		text[start] === "-" &&
		text[start + 1] === "-" &&
		text[start + 2] === "-"
	);
}

export function stripLeadingFrontmatter(text: string): StripFrontmatterResult {
	const bomOffset = text.startsWith(BOM) ? 1 : 0;

	if (!text.startsWith("---", bomOffset)) {
		return { content: text, removedLength: 0, removed: false };
	}

	const openingBreakLength = getLineBreakLength(text, bomOffset + 3);
	if (openingBreakLength === 0) {
		return { content: text, removedLength: 0, removed: false };
	}

	let lineStart = bomOffset + 3 + openingBreakLength;

	while (lineStart < text.length) {
		const lineBreakIndex = text.indexOf("\n", lineStart);
		if (lineBreakIndex === -1) {
			if (isFrontmatterDelimiterLine(text, lineStart, text.length)) {
				const removedLength = text.length;
				return {
					content: text.slice(removedLength),
					removedLength,
					removed: true,
				};
			}

			return { content: text, removedLength: 0, removed: false };
		}

		if (isFrontmatterDelimiterLine(text, lineStart, lineBreakIndex)) {
			const removedLength = lineBreakIndex + 1;
			return {
				content: text.slice(removedLength),
				removedLength,
				removed: true,
			};
		}

		lineStart = lineBreakIndex + 1;
	}

	return { content: text, removedLength: 0, removed: false };
}
