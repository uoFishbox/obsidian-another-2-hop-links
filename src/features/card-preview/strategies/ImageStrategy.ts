import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import { isImage } from "../core/previewContent";
import { generateImagePreview } from "../renderers/imagePreviewRenderer";

export function createImagePreviewStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile) {
			return isImage(file);
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			if (signal?.aborted) return undefined;
			return generateImagePreview(file, context.vault);
		},
	};
}

export default createImagePreviewStrategy;
