import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";
import { isImage } from "../core/previewContent";
import { generateImagePreview } from "../renderers/imagePreviewRenderer";

export async function resolveImagePreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (!isImage(file) || signal?.aborted) return undefined;
	return generateImagePreview(file, context.vault);
}
