import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import { isCanvas } from "../utils/previewUtils";
import { generateCanvasPreview } from "../renderers/canvasPreviewRenderer";

export function createCanvasPreviewStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile, context?: PreviewContext) {
			return isCanvas(file) && !!context?.app;
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			if (signal?.aborted || !context.app) return undefined;
			return await generateCanvasPreview(file, context.app, signal);
		},
	};
}

export default createCanvasPreviewStrategy;
