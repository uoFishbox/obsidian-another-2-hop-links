import type { TFile, App } from "obsidian";
import type { PreviewData } from "../public-types";
import { createMarkdownDomPreview } from "./domPreviewRenderer";

export async function generateCanvasPreview(
	file: TFile,
	app: App,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	try {
		if (signal?.aborted) return undefined;
		return createMarkdownDomPreview(app, file.path, `![[${file.path}]]`, {
			onError: (error) => {
				console.error(
					`Error rendering canvas preview for ${file.path}:`,
					error,
				);
			},
		});
	} catch (error) {
		console.warn(`Could not render canvas preview for ${file.path}:`, error);
	}
	return undefined;
}
