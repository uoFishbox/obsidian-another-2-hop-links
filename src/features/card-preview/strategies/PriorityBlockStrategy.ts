import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";
import { readPreviewContent } from "../core/previewContent";
import {
	findFirstAllowedFencedCodeBlockAsync,
	transformContentForPreviewAsync,
} from "../text-processing/previewTextProcessingAsync";
import { getNormalizedCodeBlockTypes } from "../text-processing/textTransformUtils";

export async function resolvePriorityBlockPreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	const renderCodeBlockTypes = context.settings?.renderCodeBlockTypes;
	if (
		file.extension !== "md" ||
		!Array.isArray(renderCodeBlockTypes) ||
		renderCodeBlockTypes.length === 0
	) {
		return undefined;
	}
	const content = await readPreviewContent(file, context, signal);
	if (!content || (!content.includes("```") && !content.includes("~~~"))) {
		return undefined;
	}

	const normalizedTypes = getNormalizedCodeBlockTypes(renderCodeBlockTypes);
	if (!normalizedTypes) return undefined;
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
}
