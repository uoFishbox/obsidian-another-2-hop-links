import { renderMath, finishRenderMath } from "obsidian";
import { createProtectedSegmentRestorer } from "../text/protectedHtml";
import {
	analyzePreviewContent,
	type PreviewContentAnalysis,
} from "../pipeline/previewContent";
import {
	queueMathJaxShadowStylesSync,
	syncMathJaxStylesForNode,
} from "shared/ui/dom/mathJaxShadowStyles";

// Hot-path optimization: avoid re-allocating this RegExp object on every
// preview render in the MathJax split loop. Module-level `g` flag regexes are
// reused across calls by resetting `lastIndex` before each scan, mirroring the
// pattern already used in `searchHighlighter.ts`.
const MATH_SPLIT_REGEX = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\$)/g;

interface ProcessPreviewContentOptions {
	enableMathRendering?: boolean;
	analysis?: PreviewContentAnalysis;
	syncShadowRootMathStyles?: boolean;
	signal?: AbortSignal;
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

	// MathJaxの処理 (既存ロジック)
	if (!enableMathRendering || !hasDollar) {
		containerEl.innerHTML = content;
	} else {
		analysis = options?.analysis ?? analyzePreviewContent(content);
		const restoreProtectedSegments = createProtectedSegmentRestorer(
			analysis.protectedSegments,
		);

		if (!analysis.hasMathExpression) {
			// 数式が無く、保護済みセグメント内の `$` だけが残っている場合は
			// MathJax のパースを回さず、そのまま復元する。
			containerEl.innerHTML = restoreProtectedSegments(
				analysis.contentForMathParsing.replace(/\\\$/g, "$"),
			);
		} else {
			containerEl.innerHTML = "";
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
					span.innerHTML = restoreProtectedSegments(textPart);
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
				span.innerHTML = restoreProtectedSegments(textPart);
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
		syncMathJaxStylesForNode(containerEl);
		queueMathJaxShadowStylesSync();
	}
}
