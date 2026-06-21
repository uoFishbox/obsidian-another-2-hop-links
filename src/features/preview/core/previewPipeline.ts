import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "./PreviewStrategy";
import type { PreviewGenerationCache } from "./previewCache";
import {
	disposePreviewData,
	getPreviewDataSize,
} from "./previewCache";
import { createAbortError, isAbortError } from "./previewAbort";

export async function runPreviewPipeline(
	file: TFile,
	context: PreviewContext,
	strategies: PreviewStrategy[],
	cache: PreviewGenerationCache,
	cacheKey: string,
	signal?: AbortSignal,
): Promise<PreviewData> {
	if (signal?.aborted) {
		throw createAbortError();
	}

	for (const strategy of strategies) {
		try {
			if (signal?.aborted) {
				throw createAbortError();
			}
			if (!strategy.canHandle(file, context)) {
				continue;
			}

			const result = await strategy.generate(file, context, signal);
			if (signal?.aborted) {
				throw createAbortError();
			}
			if (!result) {
				continue;
			}

			cache.set(
				cacheKey,
				result,
				getPreviewDataSize(result),
				() => disposePreviewData(result),
			);
			return result;
		} catch (error) {
			if (isAbortError(error)) {
				throw error;
			}
			console.warn("Preview strategy failed:", error);
		}
	}

	const emptyResult: PreviewData = { type: "empty", content: "" };
	cache.set(cacheKey, emptyResult, getPreviewDataSize(emptyResult));
	return emptyResult;
}
