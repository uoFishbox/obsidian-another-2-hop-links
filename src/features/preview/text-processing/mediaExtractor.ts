import {
	detectFenceStart,
	replaceFencedCodeBlocks,
	skipFencedCodeBlockAsync,
	type CooperativeScanOptions,
} from "./fencedCodeBlocks";

export type EmbedSyntax = "wiki" | "markdown" | "unknown";

export interface ParsedEmbed {
	syntax: EmbedSyntax;
	original: string;
	target: string;
}

const EMBED_REGEX = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/;
const INLINE_CODE_REGEX = /`[^`\n]*`/g;
const NEWLINE_CHAR_CODE = 10;

export function stripCodeSegmentsForEmbedDetection(content: string): string {
	return replaceFencedCodeBlocks(content, () => "").replace(
		INLINE_CODE_REGEX,
		"",
	);
}

function extractWikiTarget(rawTarget: string): string {
	const pipeIndex = rawTarget.indexOf("|");
	return (pipeIndex === -1 ? rawTarget : rawTarget.slice(0, pipeIndex)).trim();
}

function stripAngleBrackets(text: string): string {
	const trimmed = text.trim();
	if (
		trimmed.startsWith("<") &&
		trimmed.endsWith(">") &&
		trimmed.length >= 2
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function extractMarkdownTarget(rawTarget: string): string {
	const trimmed = rawTarget.trim();
	if (!trimmed) {
		return "";
	}

	const angleWrappedMatch = trimmed.match(/^<([^>]+)>/);
	if (angleWrappedMatch?.[1]) {
		return angleWrappedMatch[1].trim();
	}

	const firstToken = trimmed.match(/^(\S+)/)?.[1] ?? trimmed;
	return stripAngleBrackets(firstToken);
}

function skipInlineCode(content: string, startIndex: number): number {
	let fenceEnd = startIndex + 1;
	while (content[fenceEnd] === "`") {
		fenceEnd++;
	}

	const fence = content.slice(startIndex, fenceEnd);
	let searchIndex = fenceEnd;

	while (searchIndex < content.length) {
		const charCode = content.charCodeAt(searchIndex);
		if (charCode === NEWLINE_CHAR_CODE) {
			return startIndex + 1;
		}

		if (content.startsWith(fence, searchIndex)) {
			return searchIndex + fence.length;
		}

		searchIndex++;
	}

	return startIndex + 1;
}

function parseWikiEmbedAt(
	content: string,
	startIndex: number,
): ParsedEmbed | undefined {
	if (!content.startsWith("![[", startIndex)) {
		return undefined;
	}

	const targetStart = startIndex + 3;
	const targetEnd = content.indexOf("]]", targetStart);
	if (targetEnd === -1 || targetEnd === targetStart) {
		return undefined;
	}

	const rawTarget = content.slice(targetStart, targetEnd);
	return parseEmbeddedMedia(
		content.slice(startIndex, targetEnd + 2),
		extractWikiTarget(rawTarget),
	);
}

function parseMarkdownEmbedAt(
	content: string,
	startIndex: number,
): ParsedEmbed | undefined {
	if (!content.startsWith("![", startIndex)) {
		return undefined;
	}

	const altEnd = content.indexOf("]", startIndex + 2);
	if (altEnd === -1 || content[altEnd + 1] !== "(") {
		return undefined;
	}

	const targetStart = altEnd + 2;
	const targetEnd = content.indexOf(")", targetStart);
	if (targetEnd === -1 || targetEnd === targetStart) {
		return undefined;
	}

	const rawTarget = content.slice(targetStart, targetEnd);
	return parseEmbeddedMedia(
		content.slice(startIndex, targetEnd + 1),
		extractMarkdownTarget(rawTarget),
	);
}

export function parseEmbeddedMedia(
	original: string | undefined,
	fallbackLink: string,
): ParsedEmbed {
	const normalizedOriginal = (original ?? "").trim();

	if (normalizedOriginal) {
		const wikiMatch = normalizedOriginal.match(/^!\[\[([\s\S]+?)\]\]$/);
		if (wikiMatch?.[1]) {
			return {
				syntax: "wiki",
				original: normalizedOriginal,
				target: extractWikiTarget(wikiMatch[1]),
			};
		}

		const markdownMatch = normalizedOriginal.match(
			/^!\[[^\]]*?\]\(([\s\S]+?)\)$/,
		);
		if (markdownMatch?.[1]) {
			return {
				syntax: "markdown",
				original: normalizedOriginal,
				target: extractMarkdownTarget(markdownMatch[1]),
			};
		}
	}

	return {
		syntax: "unknown",
		original: normalizedOriginal || fallbackLink,
		target: fallbackLink.trim(),
	};
}

export function extractFirstEmbeddedMedia(
	content: string,
	options: CooperativeScanOptions = {},
): Promise<ParsedEmbed | undefined> {
	if (!content || !content.includes("!")) {
		return Promise.resolve(undefined);
	}

	let i = 0;
	let atLineStart = true;
	const scanEnd = Math.min(
		content.length,
		options.maxScanChars ?? content.length,
	);
	const yieldEveryChars = options.yieldEveryChars ?? 20_000;
	let lastYieldIndex = 0;

	return (async () => {
	while (i < scanEnd) {
		if (options.signal?.aborted) {
			return undefined;
		}
		if (options.yieldToMainThread && i - lastYieldIndex >= yieldEveryChars) {
			await options.yieldToMainThread();
			lastYieldIndex = i;
			if (options.signal?.aborted) {
				return undefined;
			}
		}

		if (atLineStart && detectFenceStart(content, i)) {
			i = await skipFencedCodeBlockAsync(content, i, options);
			atLineStart = true;
			continue;
		}

		const charCode = content.charCodeAt(i);
		if (charCode === NEWLINE_CHAR_CODE) {
			i++;
			atLineStart = true;
			continue;
		}

		atLineStart = false;

		if (content[i] === "`") {
			i = skipInlineCode(content, i);
			continue;
		}

		if (content[i] === "!") {
			const wikiEmbed = parseWikiEmbedAt(content, i);
			if (wikiEmbed) {
				return wikiEmbed;
			}

			const markdownEmbed = parseMarkdownEmbedAt(content, i);
			if (markdownEmbed) {
				return markdownEmbed;
			}
		}

		i++;
	}

	return undefined;
	})();
}
