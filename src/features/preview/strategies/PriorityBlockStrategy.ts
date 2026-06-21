import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import { readPreviewContent } from "../utils/previewUtils";
import {
	findFirstAllowedFencedCodeBlockAsync,
	transformContentForPreviewAsync,
} from "../text-processing/previewTextProcessingAsync";
import { getNormalizedCodeBlockTypes } from "../text-processing/textTransformUtils";

export function createCustomBlockStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile, context?: PreviewContext) {
			// Markdownファイル、かつ設定が存在し、レンダリング対象リストが空でない場合のみ処理
			return (
				file.extension === "md" &&
				!!context?.settings &&
				Array.isArray(context.settings.renderCodeBlockTypes) &&
				context.settings.renderCodeBlockTypes.length > 0
			);
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			const content = await readPreviewContent(file, context, signal);
			if (!content) return undefined;
			if (!content.includes("```") && !content.includes("~~~")) {
				return undefined;
			}

			const normalizedTypes = getNormalizedCodeBlockTypes(
				context.settings!.renderCodeBlockTypes,
			);
			if (!normalizedTypes) {
				return undefined;
			}
			const block = await findFirstAllowedFencedCodeBlockAsync(
				content,
				normalizedTypes.set,
				{
					maxScanChars: context.scanBudgetChars,
					signal,
					yieldToMainThread: context.yieldToMainThread,
				},
				normalizedTypes.array,
			);
			if (!block) return undefined;

			const rawBlock = content.slice(block.blockStart, block.blockEnd);
			return {
				type: "text",
				content: await transformContentForPreviewAsync(
					rawBlock,
					context.settings,
					undefined,
					signal,
				),
			};
		},
	};
}

export const customBlockStrategy: PreviewStrategy = createCustomBlockStrategy();

export default createCustomBlockStrategy;
