import { transformContentForPreview } from "./textTransformUtils";
import { stripLeadingFrontmatter } from "./frontmatterUtils";
import {
	findEnclosingFencedCodeBlockRange,
	type FencedCodeBlockRange,
} from "./fencedCodeBlocks";
import { findCaseInsensitiveIndex } from "./searchUtils";
import type { TextTransformContext } from "./types";
import type { PluginSettings } from "types/settings";

export interface GetContentSnippetOptions {
	firstMatchIndex?: number;
}

interface BlockDefinition {
	start: string;
	end: string;
	multiline: boolean;
	requiresClosingDelimiter?: boolean;
}

interface VisualTruncateMetrics {
	maxWeight: number;
	maxVisualLines: number;
	columns: number;
	inlineMathCells: number;
}

const BLOCK_DEFINITIONS: BlockDefinition[] = [
	{ start: "```", end: "```", multiline: true },
	{ start: "$$", end: "$$", multiline: true, requiresClosingDelimiter: true },
	{ start: "`", end: "`", multiline: false },
	{ start: "$", end: "$", multiline: false, requiresClosingDelimiter: true },
];

const VOID_ELEMENTS = new Set(["br", "hr", "img", "input", "meta", "link"]);

function getCharWeightFromCode(charCode: number): number {
	return charCode <= 127 ? 0.5 : 1.0;
}

function getDisplayCellWidth(char: string): number {
	if (char === "\t") return 2;
	if (char === " ") return 0.5;
	return getCharWeightFromCode(char.charCodeAt(0));
}

function resolvePreviewVisualMetrics(settings: PluginSettings): {
	columns: number;
	maxVisualLines: number;
} {
	const cardWidthPx =
		Number.isFinite(settings.cardWidthPx) && settings.cardWidthPx > 0
			? Math.floor(settings.cardWidthPx)
			: 140;
	const cardHeightRatio =
		Number.isFinite(settings.cardHeightRatio) &&
		settings.cardHeightRatio > 0
			? settings.cardHeightRatio
			: 1.1;
	const cardHeightPx = Math.max(1, Math.round(cardWidthPx * cardHeightRatio));

	const fontSizePx = 12;
	const lineHeightPx = fontSizePx * 1.35;
	const boxPaddingPx = 8;
	const estimatedTitleHeightPx = 42;
	const safetyMarginPx = 4;

	const previewWidthPx = Math.max(40, cardWidthPx - boxPaddingPx * 2);
	const previewHeightPx = Math.max(
		lineHeightPx,
		cardHeightPx - estimatedTitleHeightPx - safetyMarginPx,
	);
	const columns = Math.max(4, Math.floor(previewWidthPx / fontSizePx));
	const safetyMarginLines =
		Number.isFinite(settings.previewVisualLineSafetyMargin) &&
		settings.previewVisualLineSafetyMargin > 0
			? Math.floor(settings.previewVisualLineSafetyMargin)
			: 0;
	const maxVisualLinesByHeight = Math.max(
		1,
		Math.floor(previewHeightPx / lineHeightPx) + safetyMarginLines,
	);
	const configuredMaxLines =
		settings.previewMaxLines > 0 ? settings.previewMaxLines : Infinity;

	return {
		columns,
		maxVisualLines: Math.min(configuredMaxLines, maxVisualLinesByHeight),
	};
}

function normalizeSearchQuery(searchQuery?: string): string {
	return searchQuery?.trim().toLowerCase() ?? "";
}

function findClosingDelimiterIndex(
	text: string,
	fromIndex: number,
	delimiter: string,
	multiline: boolean,
): number {
	let escapeNextCharacter = false;

	for (let i = fromIndex; i < text.length; i++) {
		const char = text[i];
		if (!multiline && char === "\n") {
			return -1;
		}

		if (escapeNextCharacter) {
			escapeNextCharacter = false;
			continue;
		}

		if (char === "\\") {
			escapeNextCharacter = true;
			continue;
		}

		if (text.startsWith(delimiter, i)) {
			return i;
		}
	}

	return -1;
}

interface ScanState {
	visualLines: number;
	currentLineCells: number;
}

function addCells(
	state: ScanState,
	cells: number,
	columns: number,
): void {
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

function addHardNewline(state: ScanState): void {
	state.visualLines++;
	state.currentLineCells = 0;
}

function addDisplayMathLine(state: ScanState): void {
	if (state.currentLineCells > 0) {
		addHardNewline(state);
	}
	state.visualLines++;
	state.currentLineCells = 0;
}

function scanAndTruncate(
	text: string,
	metrics: VisualTruncateMetrics,
): { result: string; wasTruncated: boolean } {
	let i = 0;
	let weight = 0;

	// State
	const state: ScanState = { visualLines: 1, currentLineCells: 0 };
	let inBlock = false;
	let currentBlockEnd = "";
	let isBlockMultiline = true;

	let inWikiLink = false;
	let wikiLinkStart = -1;

	const tagStackNames: string[] = [];
	const tagStackStarts: number[] = [];

	let limitReached = false;

	const len = text.length;

	while (i < len) {
		if (!limitReached) {
			if (
				weight >= metrics.maxWeight ||
				state.visualLines > metrics.maxVisualLines
			) {
				limitReached = true;

				// Optimization: If we are in a safe state, we can stop immediately.
				if (!inBlock && !inWikiLink && tagStackNames.length === 0) {
					return { result: text.substring(0, i), wasTruncated: true };
				}

				// If we have unclosed tags, we must rewind to the start of the first one.
				if (tagStackNames.length > 0) {
					return {
						result: text.substring(0, tagStackStarts[0]),
						wasTruncated: true,
					};
				}

				// If in wiki link, rewind.
				if (inWikiLink) {
					return {
						result: text.substring(0, wikiLinkStart),
						wasTruncated: true,
					};
				}

				// If in block, we must continue until block ends.
			}
		} else {
			// Limit reached, we are just looking for block end.
			if (!inBlock) {
				return { result: text.substring(0, i), wasTruncated: true };
			}
		}

		const charCode = text.charCodeAt(i);
		const char = text[i];
		let skipVisibleWidth = false;

		// Handle Newlines for visual line counting
		if (char === "\n") {
			addHardNewline(state);
			if (inBlock && !isBlockMultiline) {
				// Inline block broken by newline
				inBlock = false;
				currentBlockEnd = "";
			}
		}

		// Handle Escapes
		if (char === "\\") {
			// Skip next char
			addCells(state, getDisplayCellWidth(char), metrics.columns);
			if (i + 1 < len) {
				addCells(state, getDisplayCellWidth(text[i + 1]), metrics.columns);
			}
			i += 2;
			weight += getCharWeightFromCode(92); // '\\' charCode
			if (i <= len) {
				weight += getCharWeightFromCode(text.charCodeAt(i - 1));
			}
			continue;
		}

		// State Machine Transitions

		if (inBlock) {
			// Check for block end
			if (text.startsWith(currentBlockEnd, i)) {
				i += currentBlockEnd.length;
				weight += currentBlockEnd.length * 0.5; // Approx weight
				inBlock = false;
				currentBlockEnd = "";

				// If limit was reached, we can now stop
				if (limitReached) {
					return { result: text.substring(0, i), wasTruncated: true };
				}
				continue;
			}
		} else {
			// Not in block

			// 1. Check Block Start
			let blockFound = false;
			for (const def of BLOCK_DEFINITIONS) {
				if (text.startsWith(def.start, i)) {
					const contentStart = i + def.start.length;
					const closingDelimiterIndex = def.requiresClosingDelimiter
						? findClosingDelimiterIndex(
								text,
								contentStart,
								def.end,
								def.multiline,
							)
						: -1;
					if (
						def.requiresClosingDelimiter &&
						closingDelimiterIndex === -1
					) {
						continue;
					}

					if (def.start === "$$") {
						addDisplayMathLine(state);
						i = closingDelimiterIndex + def.end.length;
						weight += 5;
						blockFound = true;
						break;
					}

					if (def.start === "$") {
						addCells(state, metrics.inlineMathCells, metrics.columns);
						i = closingDelimiterIndex + def.end.length;
						weight += metrics.inlineMathCells;
						blockFound = true;
						break;
					}

					inBlock = true;
					currentBlockEnd = def.end;
					isBlockMultiline = def.multiline;

					// Advance
					i += def.start.length;
					weight += def.start.length * 0.5;
					blockFound = true;
					break;
				}
			}
			if (blockFound) continue;

			// 2. Check Wiki Link
			if (inWikiLink) {
				if (text.startsWith("]]", i)) {
					inWikiLink = false;
					i += 2;
					weight += 1; // ]]
					continue;
				}
			} else {
				if (text.startsWith("[[", i)) {
					inWikiLink = true;
					wikiLinkStart = i;
					i += 2;
					weight += 1;
					continue;
				}
			}

			// 3. Check HTML Tags
			if (!inWikiLink && char === "<" && i + 1 < len) {
				const nextChar = text[i + 1];
				if (
					nextChar === "/" ||
					(nextChar >= "a" && nextChar <= "z") ||
					(nextChar >= "A" && nextChar <= "Z")
				) {
					const closeIndex = text.indexOf(">", i + 2);
					if (closeIndex !== -1) {
						// Process entire tag atomically
						skipVisibleWidth = true;

						// Charge weight for all tag characters
						for (let k = i; k <= closeIndex; k++) {
							weight += getCharWeightFromCode(text.charCodeAt(k));
						}

						// Parse tag name via index scan
						const tagBodyStart = nextChar === "/" ? i + 2 : i + 1;
						let tagBodyEnd = tagBodyStart;
						while (tagBodyEnd < closeIndex) {
							const c = text.charCodeAt(tagBodyEnd);
							if (
								!(
									(c >= 97 && c <= 122) ||
									(c >= 65 && c <= 90) ||
									(c >= 48 && c <= 57)
								)
							) {
								break;
							}
							tagBodyEnd++;
						}
						const tagName = text
							.substring(tagBodyStart, tagBodyEnd)
							.toLowerCase();
						const isClosing = nextChar === "/";
						const isSelfClosing =
							!isClosing && closeIndex > i + 1
								? text[closeIndex - 1] === "/"
								: false;

						if (isClosing) {
							const lastIdx = tagStackNames.length - 1;
							if (
								lastIdx >= 0 &&
								tagStackNames[lastIdx] === tagName
							) {
								tagStackNames.pop();
								tagStackStarts.pop();
							}
						} else if (
							!isSelfClosing &&
							!VOID_ELEMENTS.has(tagName)
						) {
							tagStackNames.push(tagName);
							tagStackStarts.push(i);
						}

						i = closeIndex + 1;
						continue;
					}
					// 閉じ `>` がなければタグではなく visible text の `<`
				}
			}
		}

		if (char !== "\n" && !skipVisibleWidth) {
			addCells(state, getDisplayCellWidth(char), metrics.columns);
		}
		weight += getCharWeightFromCode(charCode);
		i++;
	}

	if (!limitReached) {
		return { result: text, wasTruncated: false };
	}

	return { result: text.substring(0, i), wasTruncated: true };
}

function applyTruncation(
	content: string,
	settings: PluginSettings,
): { result: string; wasTruncated: boolean } {
	const maxChars =
		settings.previewMaxChars > 0 ? settings.previewMaxChars : Infinity;
	const visualMetrics = resolvePreviewVisualMetrics(settings);

	if (visualMetrics.maxVisualLines === Infinity && maxChars === Infinity) {
		return { result: content, wasTruncated: false };
	}

	return scanAndTruncate(content, {
		maxWeight: maxChars,
		maxVisualLines: visualMetrics.maxVisualLines,
		columns: visualMetrics.columns,
		inlineMathCells: 5,
	});
}

function buildFallbackSnippetFromRawContent(
	contentToProcess: string,
	settings: PluginSettings,
	context: TextTransformContext,
): { result: string; wasTruncated: boolean } {
	const rawTruncation = applyTruncation(contentToProcess, settings);
	const rawResult = rawTruncation.result.trim();

	if (!rawResult) {
		return {
			result: "",
			wasTruncated: rawTruncation.wasTruncated,
		};
	}

	const transformedFallback = transformContentForPreview(
		rawResult,
		settings,
		{ context, skipFrontmatterRemoval: true },
	)
		.replace(/^\n+/, "")
		.trim();

	return {
		result: transformedFallback,
		wasTruncated: rawTruncation.wasTruncated,
	};
}

const DEFAULT_SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS = 300;
const DEFAULT_SEARCH_PREVIEW_SEEK_BUFFER_CHARS = 30;

function resolveSearchPreviewSeekThresholdChars(
	settings: PluginSettings | undefined,
): number {
	const fallbackThreshold =
		settings?.previewMaxChars && settings.previewMaxChars > 0
			? settings.previewMaxChars
			: DEFAULT_SEARCH_PREVIEW_SEEK_THRESHOLD_CHARS;
	const configuredThreshold =
		settings?.searchPreviewSeekThresholdChars ?? fallbackThreshold;
	return Math.max(configuredThreshold, 0);
}

function resolveSearchPreviewSeekBufferChars(
	settings: PluginSettings | undefined,
): number {
	const configuredBuffer =
		settings?.searchPreviewSeekBufferChars ??
		DEFAULT_SEARCH_PREVIEW_SEEK_BUFFER_CHARS;
	return Math.max(configuredBuffer, 0);
}

function findEnclosingFencedCodeBlock(
	content: string,
	matchIndex: number,
): FencedCodeBlockRange | null {
	return findEnclosingFencedCodeBlockRange(content, matchIndex);
}

function buildFencedBlockSliceAroundMatch(
	content: string,
	block: FencedCodeBlockRange,
	firstMatchIndex: number,
	searchQueryLength: number,
	windowSize: number,
	searchSeekBufferChars: number,
	shouldSeekByThreshold: boolean,
): {
	contentToProcess: string;
	hasLeadingOmission: boolean;
	hasTrailingOmission: boolean;
} {
	const codeLength = block.contentEnd - block.contentStart;
	const matchOffsetInCode = Math.max(
		0,
		Math.min(codeLength, firstMatchIndex - block.contentStart),
	);
	const header = `${block.fence}${block.infoString}\n`;
	const footer = `\n${block.fence}`;
	const codeWindowSize = Math.max(
		searchQueryLength,
		windowSize - header.length - footer.length,
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

	return {
		contentToProcess: `${header}${slicedCodeBody}${footer}`,
		hasLeadingOmission: block.blockStart > 0 || leadingOmission,
		hasTrailingOmission:
			block.blockEnd < content.length || trailingOmission,
	};
}

function getContentSliceForSearch(
	content: string,
	safeLimit: number,
	settings: PluginSettings | undefined,
	normalizedSearchQuery: string,
	searchOptions?: GetContentSnippetOptions,
): {
	contentToProcess: string;
	hasLeadingOmission: boolean;
	hasTrailingOmission: boolean;
} {
	const hasSafeLimitOverflow = content.length > safeLimit;
	const hasPreviewTruncationLimit =
		(settings?.previewMaxChars ?? 0) > 0 ||
		(settings?.previewMaxLines ?? 0) > 0;

	if (!normalizedSearchQuery) {
		return {
			contentToProcess: hasSafeLimitOverflow
				? content.substring(0, safeLimit)
				: content,
			hasLeadingOmission: false,
			hasTrailingOmission: false,
		};
	}

	const firstMatchIndex =
		typeof searchOptions?.firstMatchIndex === "number"
			? searchOptions.firstMatchIndex
			: findCaseInsensitiveIndex(content, normalizedSearchQuery);

	if (firstMatchIndex === -1) {
		return {
			contentToProcess: content.substring(0, safeLimit),
			hasLeadingOmission: false,
			hasTrailingOmission: false,
		};
	}

	const searchSeekThresholdChars =
		resolveSearchPreviewSeekThresholdChars(settings);
	const searchSeekBufferChars = resolveSearchPreviewSeekBufferChars(settings);
	const shouldSeekByThreshold = firstMatchIndex > searchSeekThresholdChars;

	if (
		!hasSafeLimitOverflow &&
		!hasPreviewTruncationLimit &&
		!shouldSeekByThreshold
	) {
		return {
			contentToProcess: content,
			hasLeadingOmission: false,
			hasTrailingOmission: false,
		};
	}

	const windowSize = Math.max(safeLimit, normalizedSearchQuery.length);
	const centeredPadding = Math.max(
		0,
		Math.floor((windowSize - normalizedSearchQuery.length) / 2),
	);

	let maxLeadingChars = firstMatchIndex;
	if (settings?.previewMaxChars && settings.previewMaxChars > 0) {
		// scanAndTruncate starts from the beginning, so keep the first match
		// inside the guaranteed visible range before truncation.
		const guaranteedLeadingChars = Math.max(
			settings.previewMaxChars - normalizedSearchQuery.length,
			0,
		);
		maxLeadingChars = Math.min(maxLeadingChars, guaranteedLeadingChars);
	}

	if (settings?.previewMaxLines && settings.previewMaxLines > 0) {
		const maxLeadingLines = Math.max(settings.previewMaxLines - 1, 0);
		let lineBreakCount = 0;
		for (let i = firstMatchIndex - 1; i >= 0; i--) {
			if (content[i] !== "\n") {
				continue;
			}
			lineBreakCount++;
			if (lineBreakCount > maxLeadingLines) {
				maxLeadingChars = Math.min(
					maxLeadingChars,
					firstMatchIndex - (i + 1),
				);
				break;
			}
		}
	}

	if (shouldSeekByThreshold) {
		maxLeadingChars = Math.min(maxLeadingChars, searchSeekBufferChars);
	}

	const sidePadding = Math.min(centeredPadding, maxLeadingChars);
	let sliceStart = Math.max(0, firstMatchIndex - sidePadding);
	let sliceEnd = Math.min(content.length, sliceStart + windowSize);

	const enclosingFencedBlock = findEnclosingFencedCodeBlock(
		content,
		firstMatchIndex,
	);
	if (enclosingFencedBlock) {
		const cutsFenceBoundary =
			sliceStart > enclosingFencedBlock.blockStart ||
			sliceEnd < enclosingFencedBlock.blockEnd;
		if (cutsFenceBoundary) {
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

export function getContentSnippet(
	content: string,
	settings?: PluginSettings,
	searchQuery?: string,
	searchOptions?: GetContentSnippetOptions,
): string {
	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
	const context: TextTransformContext =
		normalizedSearchQuery.length > 0 ? "searchSnippet" : "preview";
	const strippedFrontmatter = stripLeadingFrontmatter(content);
	const effectiveContent = strippedFrontmatter.content;
	const effectiveSearchOptions =
		normalizedSearchQuery.length > 0 && strippedFrontmatter.removed
			? {
					firstMatchIndex: findCaseInsensitiveIndex(
						effectiveContent,
						normalizedSearchQuery,
					),
				}
			: searchOptions;

	// 巨大ファイルの全体変換を避けるため、事前にスライスする
	const SAFE_LIMIT = Math.max((settings?.previewMaxChars ?? 300) * 4, 2500);
	const contentSlice = getContentSliceForSearch(
		effectiveContent,
		SAFE_LIMIT,
		settings,
		normalizedSearchQuery,
		effectiveSearchOptions,
	);
	const contentToProcess = contentSlice.contentToProcess;

	let processedContent = transformContentForPreview(
		contentToProcess,
		settings,
		{ context, skipFrontmatterRemoval: true },
	);
	processedContent = processedContent.replace(/^[\r\n]+/, "");

	if (
		!settings ||
		(settings.previewMaxLines <= 0 && settings.previewMaxChars <= 0)
	) {
		return processedContent;
	}

	const { result, wasTruncated } = applyTruncation(
		processedContent,
		settings,
	);

	let trimmedResult = result.trim();
	let effectiveWasTruncated = wasTruncated;

	// 長いコードブロック由来のHTMLタグで先頭まで巻き戻された場合は、
	// 生Markdownを先に切り詰めてから再変換する。
	if (!trimmedResult) {
		const fallback = buildFallbackSnippetFromRawContent(
			contentToProcess,
			settings,
			context,
		);
		trimmedResult = fallback.result;
		effectiveWasTruncated = effectiveWasTruncated || fallback.wasTruncated;
	}

	if (!trimmedResult) {
		return "";
	}

	let finalResult = trimmedResult;
	if (contentSlice.hasLeadingOmission) {
		finalResult = "..." + finalResult;
	}
	if (effectiveWasTruncated || contentSlice.hasTrailingOmission) {
		finalResult += "...";
	}

	return finalResult;
}
