import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";
import { isCanvas } from "../core/previewContent";
import { generateCanvasPreview } from "../renderers/canvasPreviewRenderer";

export async function resolveCanvasPreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (!isCanvas(file) || signal?.aborted || !context.app) return undefined;
	return await generateCanvasPreview(file, context.app, signal);
}
