import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import { isVideo } from "../utils/previewUtils";
import { generateVideoPreview } from "../renderers/videoPreviewRenderer";

export function createVideoPreviewStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile) {
			return isVideo(file);
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
			if (signal?.aborted) return undefined;
			return await generateVideoPreview(file, signal);
		},
	};
}

export const videoPreviewStrategy: PreviewStrategy = createVideoPreviewStrategy();

export default createVideoPreviewStrategy;
