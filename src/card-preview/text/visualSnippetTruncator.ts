import type { PreviewSnippetSettings } from "./types";

/** Result of safely truncating transformed preview content. */
export interface TruncationResult {
	readonly content: string;
	readonly truncated: boolean;
}

interface VisualTruncateMetrics {
	readonly maxWeight: number;
	readonly maxVisualLines: number;
	readonly columns: number;
	readonly inlineMathCells: number;
}

interface VisualScanState {
	visualLines: number;
	currentLineCells: number;
}

interface OpenCodeBlock {
	readonly end: "`" | "```";
	readonly multiline: boolean;
}

interface OpenCodeBlockSpan {
	readonly tagStart: number;
	readonly contentStart: number;
	readonly stackDepth: number;
}

const INLINE_CODE_BLOCK: OpenCodeBlock = { end: "`", multiline: false };
const FENCED_CODE_BLOCK: OpenCodeBlock = { end: "```", multiline: true };
const VOID_ELEMENTS = new Set(["br", "hr", "img", "input", "meta", "link"]);
const CODE_BLOCK_OPEN_TAG = '<span class="cosense-card-links__code-block">';

const DEFAULT_CARD_WIDTH_PX = 140;
const DEFAULT_CARD_HEIGHT_RATIO = 1.1;
const PREVIEW_FONT_SIZE_PX = 12;
const PREVIEW_LINE_HEIGHT_PX = PREVIEW_FONT_SIZE_PX * 1.35;
const PREVIEW_BOX_PADDING_PX = 8;
const ESTIMATED_TITLE_HEIGHT_PX = 42;
const PREVIEW_SAFETY_MARGIN_PX = 4;
const INLINE_MATH_CELLS = 5;
const DISPLAY_MATH_WEIGHT = 5;

function getCharWeightFromCode(charCode: number): number {
	return charCode <= 127 ? 0.5 : 1;
}

function getDisplayCellWidthFromCode(charCode: number): number {
	if (charCode === 9) return 2;
	if (charCode === 32) return 0.5;
	return getCharWeightFromCode(charCode);
}

function resolvePreviewVisualMetrics(settings: PreviewSnippetSettings): {
	columns: number;
	maxVisualLines: number;
} {
	const cardWidthPx =
		Number.isFinite(settings.cardWidthPx) && settings.cardWidthPx > 0
			? Math.floor(settings.cardWidthPx)
			: DEFAULT_CARD_WIDTH_PX;
	const cardHeightRatio =
		Number.isFinite(settings.cardHeightRatio) && settings.cardHeightRatio > 0
			? settings.cardHeightRatio
			: DEFAULT_CARD_HEIGHT_RATIO;
	const cardHeightPx = Math.max(1, Math.round(cardWidthPx * cardHeightRatio));
	const previewWidthPx = Math.max(40, cardWidthPx - PREVIEW_BOX_PADDING_PX * 2);
	const previewHeightPx = Math.max(
		PREVIEW_LINE_HEIGHT_PX,
		cardHeightPx - ESTIMATED_TITLE_HEIGHT_PX - PREVIEW_SAFETY_MARGIN_PX,
	);
	const columns = Math.max(4, Math.floor(previewWidthPx / PREVIEW_FONT_SIZE_PX));
	const safetyMarginLines =
		Number.isFinite(settings.previewVisualLineSafetyMargin) &&
		settings.previewVisualLineSafetyMargin > 0
			? Math.floor(settings.previewVisualLineSafetyMargin)
			: 0;
	const maxVisualLinesByHeight = Math.max(
		1,
		Math.floor(previewHeightPx / PREVIEW_LINE_HEIGHT_PX) + safetyMarginLines,
	);
	const configuredMaxLines =
		settings.previewMaxLines > 0 ? settings.previewMaxLines : Infinity;

	return {
		columns,
		maxVisualLines: Math.min(configuredMaxLines, maxVisualLinesByHeight),
	};
}

function findClosingDelimiterIndex(
	text: string,
	fromIndex: number,
	delimiter: string,
	multiline: boolean,
): number {
	let escapeNextCharacter = false;

	for (let index = fromIndex; index < text.length; index++) {
		const char = text[index];
		if (!multiline && char === "\n") return -1;

		if (escapeNextCharacter) {
			escapeNextCharacter = false;
			continue;
		}

		if (char === "\\") {
			escapeNextCharacter = true;
			continue;
		}

		if (text.startsWith(delimiter, index)) return index;
	}

	return -1;
}

function addCells(state: VisualScanState, cells: number, columns: number): void {
	if (cells <= 0) return;

	if (state.currentLineCells + cells <= columns) {
		state.currentLineCells += cells;
		return;
	}

	const remaining = Math.max(columns - state.currentLineCells, 0);
	cells -= remaining;
	state.visualLines++;
	state.currentLineCells = 0;

	if (cells > columns) {
		const fullLines = Math.floor(cells / columns);
		state.visualLines += fullLines;
		state.currentLineCells = cells % columns;
		return;
	}

	state.currentLineCells = cells;
}

function addHardNewline(state: VisualScanState): void {
	state.visualLines++;
	state.currentLineCells = 0;
}

function addDisplayMathLine(state: VisualScanState): void {
	if (state.currentLineCells > 0) addHardNewline(state);
	state.visualLines++;
	state.currentLineCells = 0;
}

function findSafeBlockTruncationEnd(
	text: string,
	fromIndex: number,
	delimiter: string,
	multiline: boolean,
): number {
	let scanIndex = fromIndex;

	while (scanIndex < text.length) {
		const char = text[scanIndex];
		if (!multiline && char === "\n") return scanIndex + 1;

		if (char === "\\") {
			scanIndex += 2;
			continue;
		}

		if (text.startsWith(delimiter, scanIndex)) {
			return scanIndex + delimiter.length;
		}

		scanIndex++;
	}

	return text.length;
}

function resolveSafeTruncationEnd(
	text: string,
	index: number,
	firstUnclosedTagStart: number,
	wikiLinkStart: number,
	openCodeBlock: OpenCodeBlock | undefined,
): number {
	if (firstUnclosedTagStart !== -1) return firstUnclosedTagStart;
	if (wikiLinkStart !== -1) return wikiLinkStart;
	if (!openCodeBlock) return index;

	return findSafeBlockTruncationEnd(
		text,
		index,
		openCodeBlock.end,
		openCodeBlock.multiline,
	);
}

function avoidSplittingHtmlEntity(
	text: string,
	index: number,
	contentStart: number,
): number {
	const entityStart = text.lastIndexOf("&", index - 1);
	if (entityStart < contentStart) return index;

	const entityEnd = text.lastIndexOf(";", index - 1);
	return entityStart > entityEnd ? entityStart : index;
}

function scanAndTruncate(
	text: string,
	metrics: VisualTruncateMetrics,
): TruncationResult {
	let index = 0;
	let weight = 0;
	const state: VisualScanState = { visualLines: 1, currentLineCells: 0 };
	let openCodeBlock: OpenCodeBlock | undefined;
	let wikiLinkStart = -1;
	const tagStackNames: string[] = [];
	let firstUnclosedTagStart = -1;
	let openCodeBlockSpan: OpenCodeBlockSpan | undefined;
	const length = text.length;

	while (index < length) {
		if (weight >= metrics.maxWeight || state.visualLines > metrics.maxVisualLines) {
			if (
				openCodeBlockSpan &&
				firstUnclosedTagStart === openCodeBlockSpan.tagStart &&
				index > openCodeBlockSpan.contentStart
			) {
				const safeIndex = avoidSplittingHtmlEntity(
					text,
					index,
					openCodeBlockSpan.contentStart,
				);
				return {
					content: text.substring(0, safeIndex) + "</span>",
					truncated: true,
				};
			}

			const safeEnd = resolveSafeTruncationEnd(
				text,
				index,
				firstUnclosedTagStart,
				wikiLinkStart,
				openCodeBlock,
			);
			return { content: text.substring(0, safeEnd), truncated: true };
		}

		const charCode = text.charCodeAt(index);
		const char = text[index];

		if (char === "\n") {
			addHardNewline(state);
			if (openCodeBlock && !openCodeBlock.multiline) {
				openCodeBlock = undefined;
			}
		}

		if (char === "\\") {
			addCells(state, getDisplayCellWidthFromCode(charCode), metrics.columns);
			if (index + 1 < length) {
				const escapedCharCode = text.charCodeAt(index + 1);
				addCells(
					state,
					getDisplayCellWidthFromCode(escapedCharCode),
					metrics.columns,
				);
			}

			index += 2;
			weight += getCharWeightFromCode(charCode);
			if (index <= length) {
				weight += getCharWeightFromCode(text.charCodeAt(index - 1));
			}
			continue;
		}

		if (openCodeBlock) {
			if (text.startsWith(openCodeBlock.end, index)) {
				index += openCodeBlock.end.length;
				weight += openCodeBlock.end.length * 0.5;
				openCodeBlock = undefined;
				continue;
			}
		} else {
			if (char === "$" && text.startsWith("$$", index)) {
				const closingDelimiterIndex = findClosingDelimiterIndex(
					text,
					index + 2,
					"$$",
					true,
				);
				if (closingDelimiterIndex !== -1) {
					addDisplayMathLine(state);
					index = closingDelimiterIndex + 2;
					weight += DISPLAY_MATH_WEIGHT;
					continue;
				}
			}

			if (char === "$") {
				const closingDelimiterIndex = findClosingDelimiterIndex(
					text,
					index + 1,
					"$",
					false,
				);
				if (closingDelimiterIndex !== -1) {
					addCells(state, metrics.inlineMathCells, metrics.columns);
					index = closingDelimiterIndex + 1;
					weight += metrics.inlineMathCells;
					continue;
				}
			}

			if (char === "`") {
				openCodeBlock = text.startsWith("```", index)
					? FENCED_CODE_BLOCK
					: INLINE_CODE_BLOCK;
				index += openCodeBlock.end.length;
				weight += openCodeBlock.end.length * 0.5;
				continue;
			}

			if (wikiLinkStart !== -1) {
				if (char === "]" && text[index + 1] === "]") {
					wikiLinkStart = -1;
					index += 2;
					weight += 1;
					continue;
				}
			} else if (char === "[" && text[index + 1] === "[") {
				wikiLinkStart = index;
				index += 2;
				weight += 1;
				continue;
			}

			if (wikiLinkStart === -1 && char === "<" && index + 1 < length) {
				const nextChar = text[index + 1];
				if (
					nextChar === "/" ||
					(nextChar >= "a" && nextChar <= "z") ||
					(nextChar >= "A" && nextChar <= "Z")
				) {
					const closeIndex = text.indexOf(">", index + 2);
					if (closeIndex !== -1) {
						for (let tagIndex = index; tagIndex <= closeIndex; tagIndex++) {
							weight += getCharWeightFromCode(text.charCodeAt(tagIndex));
						}

						const tagBodyStart = nextChar === "/" ? index + 2 : index + 1;
						let tagBodyEnd = tagBodyStart;
						while (tagBodyEnd < closeIndex) {
							const code = text.charCodeAt(tagBodyEnd);
							const isTagNameCharacter =
								(code >= 97 && code <= 122) ||
								(code >= 65 && code <= 90) ||
								(code >= 48 && code <= 57);
							if (!isTagNameCharacter) break;
							tagBodyEnd++;
						}

						const tagName = text
							.substring(tagBodyStart, tagBodyEnd)
							.toLowerCase();
						const isClosing = nextChar === "/";
						const isSelfClosing =
							!isClosing && closeIndex > index + 1
								? text[closeIndex - 1] === "/"
								: false;

						if (isClosing) {
							const lastIndex = tagStackNames.length - 1;
							if (
								lastIndex >= 0 &&
								tagStackNames[lastIndex] === tagName
							) {
								const closingDepth = tagStackNames.length;
								tagStackNames.pop();
								if (
									openCodeBlockSpan?.stackDepth === closingDepth &&
									tagName === "span"
								) {
									openCodeBlockSpan = undefined;
								}
								if (tagStackNames.length === 0)
									firstUnclosedTagStart = -1;
							}
						} else if (!isSelfClosing && !VOID_ELEMENTS.has(tagName)) {
							if (tagStackNames.length === 0)
								firstUnclosedTagStart = index;
							tagStackNames.push(tagName);
							if (text.startsWith(CODE_BLOCK_OPEN_TAG, index)) {
								openCodeBlockSpan = {
									tagStart: index,
									contentStart: closeIndex + 1,
									stackDepth: tagStackNames.length,
								};
							}
						}

						index = closeIndex + 1;
						continue;
					}
				}
			}
		}

		if (char !== "\n") {
			addCells(state, getDisplayCellWidthFromCode(charCode), metrics.columns);
		}
		weight += getCharWeightFromCode(charCode);
		index++;
	}

	return { content: text, truncated: false };
}

/** Truncates transformed preview content without breaking protected constructs. */
export function truncatePreviewContent(
	content: string,
	settings: PreviewSnippetSettings,
): TruncationResult {
	const maxChars = settings.previewMaxChars > 0 ? settings.previewMaxChars : Infinity;
	const visualMetrics = resolvePreviewVisualMetrics(settings);

	if (visualMetrics.maxVisualLines === Infinity && maxChars === Infinity) {
		return { content, truncated: false };
	}

	return scanAndTruncate(content, {
		maxWeight: maxChars,
		maxVisualLines: visualMetrics.maxVisualLines,
		columns: visualMetrics.columns,
		inlineMathCells: INLINE_MATH_CELLS,
	});
}
