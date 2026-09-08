import { finishRenderMath, renderMath, sanitizeHTMLToDom } from "obsidian";
import { createProtectedSegmentRestorer } from "../text/protectedHtml";
import {
	analyzePreviewContent,
	type PreviewContentAnalysis,
} from "../pipeline/previewContent";
import {
	queueMathShadowStylesSync,
	syncMathStylesForNode,
} from "shared/ui/dom/mathShadowStyles";

// Hot-path optimization: avoid re-allocating this RegExp object on every
// preview render in the math split loop. Module-level `g` flag regexes are
// reused across calls by resetting `lastIndex` before each scan, mirroring the
// pattern already used in `searchHighlighter.ts`.
const MATH_SPLIT_REGEX = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\$)/g;

interface ProcessPreviewContentOptions {
	enableMathRendering?: boolean;
	analysis?: PreviewContentAnalysis;
	syncShadowRootMathStyles?: boolean;
	signal?: AbortSignal;
}

function replaceWithSanitizedHtml(containerEl: HTMLElement, html: string): void {
	containerEl.replaceChildren(sanitizeHTMLToDom(html));
}

function appendSanitizedHtml(containerEl: HTMLElement, html: string): void {
	containerEl.append(sanitizeHTMLToDom(html));
}

export async function processPreviewContent(
	containerEl: HTMLElement,
	content: string,
	options?: ProcessPreviewContentOptions,
) {
	const signal = options?.signal;
	if (signal?.aborted) {
		return;
	}

	const enableMathRendering = options?.enableMathRendering ?? true;
	const syncShadowRootMathStyles = options?.syncShadowRootMathStyles ?? true;
	const hasDollar = content.includes("$");
	let analysis: PreviewContentAnalysis | undefined;

	if (signal?.aborted) {
		return;
	}

	if (!enableMathRendering || !hasDollar) {
		replaceWithSanitizedHtml(containerEl, content);
	} else {
		analysis = options?.analysis ?? analyzePreviewContent(content);
		const restoreProtectedSegments = createProtectedSegmentRestorer(
			analysis.protectedSegments,
		);

		if (!analysis.hasMathExpression) {
			replaceWithSanitizedHtml(
				containerEl,
				restoreProtectedSegments(
					analysis.contentForMathParsing.replace(/\\\$/g, "$"),
				),
			);
		} else {
			containerEl.replaceChildren();
			MATH_SPLIT_REGEX.lastIndex = 0;
			let lastIndex = 0;
			const { contentForMathParsing } = analysis;

			while (true) {
				if (signal?.aborted) {
					return;
				}

				const match = MATH_SPLIT_REGEX.exec(contentForMathParsing);
				if (!match) break;

				if (match.index > lastIndex) {
					const textPart = contentForMathParsing.substring(
						lastIndex,
						match.index,
					);
					const span = containerEl.createSpan();
					appendSanitizedHtml(span, restoreProtectedSegments(textPart));
				}

				const matchedString = match[0];
				if (matchedString.startsWith("$$") && matchedString.endsWith("$$")) {
					const mathContent = matchedString.substring(
						2,
						matchedString.length - 2,
					);
					containerEl.appendChild(renderMath(mathContent, true));
				} else if (
					matchedString.startsWith("$") &&
					matchedString.endsWith("$")
				) {
					const mathContent = matchedString.substring(
						1,
						matchedString.length - 1,
					);
					containerEl.appendChild(renderMath(mathContent, false));
				} else if (matchedString === "\\$") {
					containerEl.appendChild(
						containerEl.ownerDocument.createTextNode("$"),
					);
				}

				lastIndex = MATH_SPLIT_REGEX.lastIndex;
			}

			if (lastIndex < contentForMathParsing.length) {
				const textPart = contentForMathParsing.substring(lastIndex);
				const span = containerEl.createSpan();
				appendSanitizedHtml(span, restoreProtectedSegments(textPart));
			}

			if (signal?.aborted) {
				return;
			}

			await finishRenderMath();

			if (signal?.aborted) {
				return;
			}
		}
	}

	if (signal?.aborted) {
		return;
	}

	if (analysis?.hasMathExpression && syncShadowRootMathStyles) {
		syncMathStylesForNode(containerEl);
		queueMathShadowStylesSync();
	}
}
