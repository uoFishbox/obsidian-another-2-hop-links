export interface FencedCodeBlockRange {
	blockStart: number;
	blockEnd: number;
	contentStart: number;
	contentEnd: number;
	fence: string;
	infoString: string;
}

export interface FenceStart {
	fence: string;
	fenceChar: string;
	fenceLength: number;
	fenceStart: number;
	lineEnd: number;
	infoString: string;
}

export interface CooperativeScanOptions {
	maxScanChars?: number;
	signal?: AbortSignal;
	yieldEveryChars?: number;
	yieldToMainThread?: () => Promise<void>;
}

const DEFAULT_YIELD_EVERY_CHARS = 20_000;

function getLineEnd(content: string, fromIndex: number): number {
	const lineEnd = content.indexOf("\n", fromIndex);
	return lineEnd === -1 ? content.length : lineEnd;
}

function getNextLineStart(content: string, lineEnd: number): number {
	return lineEnd < content.length ? lineEnd + 1 : lineEnd;
}

function stripTrailingCarriageReturn(value: string): string {
	return value.endsWith("\r") ? value.slice(0, -1) : value;
}

export function detectFenceStart(
	content: string,
	lineStartIndex: number,
): FenceStart | undefined {
	let i = lineStartIndex;
	while (content[i] === " " || content[i] === "\t") {
		i++;
	}

	const fenceChar = content[i];
	if (fenceChar !== "`" && fenceChar !== "~") {
		return undefined;
	}

	let fenceEnd = i + 1;
	while (content[fenceEnd] === fenceChar) {
		fenceEnd++;
	}

	const fenceLength = fenceEnd - i;
	if (fenceLength < 3) {
		return undefined;
	}

	const lineEnd = getLineEnd(content, fenceEnd);
	return {
		fence: content.slice(i, fenceEnd),
		fenceChar,
		fenceLength,
		fenceStart: i,
		lineEnd,
		infoString: stripTrailingCarriageReturn(content.slice(fenceEnd, lineEnd)),
	};
}

function isClosingFenceLine(
	content: string,
	lineStartIndex: number,
	openingFence: FenceStart,
): boolean {
	let i = lineStartIndex;
	while (content[i] === " " || content[i] === "\t") {
		i++;
	}

	let fenceEnd = i;
	while (content[fenceEnd] === openingFence.fenceChar) {
		fenceEnd++;
	}

	if (fenceEnd - i < openingFence.fenceLength) {
		return false;
	}

	const lineEnd = getLineEnd(content, fenceEnd);
	for (let j = fenceEnd; j < lineEnd; j++) {
		const char = content[j];
		if (char !== " " && char !== "\t" && char !== "\r") {
			return false;
		}
	}

	return true;
}

function getContentEndBeforeClosingLine(
	content: string,
	contentStart: number,
	closingLineStart: number,
): number {
	let contentEnd = closingLineStart;
	if (contentEnd > contentStart && content[contentEnd - 1] === "\n") {
		contentEnd--;
	}
	if (contentEnd > contentStart && content[contentEnd - 1] === "\r") {
		contentEnd--;
	}
	return contentEnd;
}

function findFencedCodeBlockAtLineStart(
	content: string,
	lineStartIndex: number,
): FencedCodeBlockRange | undefined {
	const openingFence = detectFenceStart(content, lineStartIndex);
	if (!openingFence) {
		return undefined;
	}

	const contentStart = getNextLineStart(content, openingFence.lineEnd);
	let nextLineStart = contentStart;

	while (nextLineStart < content.length) {
		const lineEnd = getLineEnd(content, nextLineStart);
		if (isClosingFenceLine(content, nextLineStart, openingFence)) {
			const blockEnd = getNextLineStart(content, lineEnd);
			return {
				blockStart: lineStartIndex,
				blockEnd,
				contentStart,
				contentEnd: getContentEndBeforeClosingLine(
					content,
					contentStart,
					nextLineStart,
				),
				fence: openingFence.fence,
				infoString: openingFence.infoString,
			};
		}

		nextLineStart = getNextLineStart(content, lineEnd);
	}

	return undefined;
}

async function findFencedCodeBlockAtLineStartAsync(
	content: string,
	lineStartIndex: number,
	options: CooperativeScanOptions = {},
): Promise<FencedCodeBlockRange | undefined> {
	if (options.signal?.aborted) {
		return undefined;
	}

	const openingFence = detectFenceStart(content, lineStartIndex);
	if (!openingFence) {
		return undefined;
	}

	const scanEnd = Math.min(content.length, options.maxScanChars ?? content.length);
	const yieldEveryChars = options.yieldEveryChars ?? DEFAULT_YIELD_EVERY_CHARS;
	let lastYieldIndex = lineStartIndex;

	const contentStart = getNextLineStart(content, openingFence.lineEnd);
	let nextLineStart = contentStart;

	while (nextLineStart < scanEnd) {
		if (options.signal?.aborted) {
			return undefined;
		}
		if (
			options.yieldToMainThread &&
			nextLineStart - lastYieldIndex >= yieldEveryChars
		) {
			await options.yieldToMainThread();
			lastYieldIndex = nextLineStart;
			if (options.signal?.aborted) {
				return undefined;
			}
		}

		const lineEnd = getLineEnd(content, nextLineStart);
		if (isClosingFenceLine(content, nextLineStart, openingFence)) {
			const blockEnd = getNextLineStart(content, lineEnd);
			if (blockEnd > scanEnd) {
				return undefined;
			}
			return {
				blockStart: lineStartIndex,
				blockEnd,
				contentStart,
				contentEnd: getContentEndBeforeClosingLine(
					content,
					contentStart,
					nextLineStart,
				),
				fence: openingFence.fence,
				infoString: openingFence.infoString,
			};
		}

		nextLineStart = getNextLineStart(content, lineEnd);
	}

	return undefined;
}

export function skipFencedCodeBlock(content: string, lineStartIndex: number): number {
	const block = findFencedCodeBlockAtLineStart(content, lineStartIndex);
	if (block) {
		return block.blockEnd;
	}

	return detectFenceStart(content, lineStartIndex) ? content.length : lineStartIndex;
}

export async function skipFencedCodeBlockAsync(
	content: string,
	lineStartIndex: number,
	options: CooperativeScanOptions = {},
): Promise<number> {
	const block = await findFencedCodeBlockAtLineStartAsync(
		content,
		lineStartIndex,
		options,
	);
	if (block) {
		return block.blockEnd;
	}

	return detectFenceStart(content, lineStartIndex)
		? Math.min(content.length, options.maxScanChars ?? content.length)
		: lineStartIndex;
}

/** Finds the closed fenced code block whose body contains the given offset. */
export function findFencedCodeBlockContainingOffset(
	content: string,
	matchIndex: number,
): FencedCodeBlockRange | null {
	if (
		content.lastIndexOf("```", matchIndex) === -1 &&
		content.lastIndexOf("~~~", matchIndex) === -1
	) {
		return null;
	}

	let lineStart = 0;

	while (lineStart < content.length) {
		const block = findFencedCodeBlockAtLineStart(content, lineStart);
		if (block) {
			if (matchIndex >= block.contentStart && matchIndex <= block.contentEnd) {
				return block;
			}
			if (block.blockStart > matchIndex) {
				break;
			}
			lineStart = block.blockEnd;
			continue;
		}

		const lineEnd = getLineEnd(content, lineStart);
		if (lineStart > matchIndex) {
			break;
		}
		lineStart = getNextLineStart(content, lineEnd);
	}

	return null;
}

export function replaceFencedCodeBlocks(
	content: string,
	replacement: (block: FencedCodeBlockRange) => string,
): string {
	let lineStart = 0;
	let copiedUntil = 0;
	let output = "";

	while (lineStart < content.length) {
		const block = findFencedCodeBlockAtLineStart(content, lineStart);
		if (block) {
			output += content.slice(copiedUntil, block.blockStart);
			output += replacement(block);
			copiedUntil = block.blockEnd;
			lineStart = block.blockEnd;
			continue;
		}

		const lineEnd = getLineEnd(content, lineStart);
		lineStart = getNextLineStart(content, lineEnd);
	}

	return output + content.slice(copiedUntil);
}
