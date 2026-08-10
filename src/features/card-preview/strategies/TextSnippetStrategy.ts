import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext } from "../core/previewResolver";
import { isSource, readPreviewContent } from "../core/previewContent";
import { getContentSnippetAsync } from "../text-processing/previewTextProcessingAsync";

export async function resolveTextSnippetPreview(
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
): Promise<PreviewData | undefined> {
	if (file.extension !== "md" && !isSource(file)) return undefined;
	const content = await readPreviewContent(file, context, signal);
	if (!content) return undefined;
	const snippet = await getContentSnippetAsync(
		content,
		context.settings,
		undefined,
		undefined,
		signal,
	);
	if (!snippet) return { type: "empty", content: "" };
	return { type: "text", content: snippet };
}
