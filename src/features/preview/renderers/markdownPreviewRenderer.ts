import type { TFile, App } from "obsidian";
import {
	renderMath,
	finishRenderMath,
	Component,
	MarkdownRenderer,
} from "obsidian";
import { transformContentForPreview } from "../text-processing/textTransformUtils";
import { createProtectedSegmentRestorer } from "../text-processing/protectedHtml";
import {
	analyzePreviewContent,
	type PreviewContentAnalysis,
} from "../utils/previewUtils";
import {
	queueMathJaxShadowStylesSync,
	syncMathJaxStylesForNode,
} from "ui/utils/mathJaxShadowStyles";

export { transformContentForPreview };

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
	app: App,
	sourcePath: string,
	component: Component,
	options?: ProcessPreviewContentOptions,
) {
	const signal = options?.signal;
	if (signal?.aborted) {
		return;
	}

	const enableMathRendering = options?.enableMathRendering ?? true;
	const syncShadowRootMathStyles =
		options?.syncShadowRootMathStyles ?? true;
	const analysis =
		options?.analysis ??
		(enableMathRendering || content.includes("$")
			? analyzePreviewContent(content)
			: {
					hasDollar: false,
					hasMathExpression: false,
					contentForMathParsing: content,
					protectedSegments: [],
				});
	const restoreProtectedSegments = createProtectedSegmentRestorer(
		analysis.protectedSegments,
	);

	if (signal?.aborted) {
		return;
	}

	// MathJaxの処理 (既存ロジック)
	if (!enableMathRendering || !analysis.hasDollar) {
		containerEl.innerHTML = analysis.hasDollar
			? restoreProtectedSegments(analysis.contentForMathParsing)
			: content;
	} else if (!analysis.hasMathExpression) {
		// 数式が無く、保護済みセグメント内の `$` だけが残っている場合は
		// MathJax のパースを回さず、そのまま復元する。
		containerEl.innerHTML = restoreProtectedSegments(
			analysis.contentForMathParsing.replace(/\\\$/g, "$"),
		);
	} else {
		containerEl.innerHTML = "";
		// 案B: インライン数式 `$...$` のパターンを hasMathExpression と統一。
		// `[^$\n]+?` = 改行を含まず最低1文字のみマッチ。
		// [\s\S]*? を使うと `$a` と数行後の `$b` が誤ってペアになる可能性があった。
		// $$...$$ は複数行を許容するため [\s\S]*? を維持する。
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
				// ここではinnerHTMLを使うため、HTMLタグ（twohop-render-blockなど）も維持される
				const span = containerEl.createSpan();
				span.innerHTML = restoreProtectedSegments(textPart);
			}

			const matchedString = match[0];
			// ... existing MathJax rendering logic ...
			if (
				matchedString.startsWith("$$") &&
				matchedString.endsWith("$$")
			) {
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
				containerEl.appendChild(document.createTextNode("$"));
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

	if (signal?.aborted) {
		return;
	}

	const hasRenderBlocks = content.includes("twohop-render-block");
	if (hasRenderBlocks) {
		const renderBlocks = containerEl.querySelectorAll(".twohop-render-block");
		if (renderBlocks.length > 0) {
			await Promise.allSettled(
				Array.from(renderBlocks, async (renderBlock) => {
					if (signal?.aborted) {
						return;
					}

					const block = renderBlock as HTMLElement;
					const lang = block.getAttribute("data-lang") || "";
					const encodedCode = block.getAttribute("data-code") || "";

					if (!lang || !encodedCode) {
						return;
					}

					try {
						const code = decodeURIComponent(encodedCode);
						// ブロックの中身をクリア
						block.innerHTML = "";
						// MarkdownRendererを使用してレンダリング
						// ブロック形式 (```lang ... ```) として渡す
						const markdown = "```" + lang + "\n" + code + "\n```";
						if (signal?.aborted) {
							return;
						}
						await MarkdownRenderer.render(
							app,
							markdown,
							block,
							sourcePath,
							component,
						);
					} catch (e) {
						if (signal?.aborted) {
							return;
						}
						console.error("Failed to render code block in preview:", e);
						block.textContent = "Render Error";
					}
				}),
			);
		}
	}

	if (signal?.aborted) {
		return;
	}

	if (analysis.hasMathExpression && syncShadowRootMathStyles) {
		syncMathJaxStylesForNode(containerEl);
		queueMathJaxShadowStylesSync();
	}
}
