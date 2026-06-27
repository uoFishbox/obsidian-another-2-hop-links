import type { TFile } from "obsidian";
import type { PreviewData } from "../public-types";
import type { PreviewContext, PreviewStrategy } from "../core/PreviewStrategy";
import { isSource, readPreviewContent } from "../utils/previewUtils";
import { getContentSnippetAsync } from "../text-processing/previewTextProcessingAsync";

export function createTextSnippetStrategy(): PreviewStrategy {
	return {
		canHandle(file: TFile) {
			return file.extension === "md" || isSource(file);
		},

		async generate(
			file: TFile,
			context: PreviewContext,
			signal?: AbortSignal,
		): Promise<PreviewData | undefined> {
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
		},
	};
}

export default createTextSnippetStrategy;
