import { canvasToSearchText } from "./canvasText";
import { findFirstAllowedFencedCodeBlock } from "./fencedCodeBlocks";
import { extractFirstEmbeddedMedia } from "./mediaExtractor";
import { getContentSnippet } from "./snippetExtractor";
import { highlightSearchMatchesInHtml } from "./searchHighlighter";
import { transformContentForPreview } from "./textTransformUtils";
import type {
	PreviewTextWorkerRequest,
	PreviewTextWorkerResponse,
} from "./previewTextWorkerTypes";

export {};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (typeof self !== "undefined") {
	self.onmessage = async (
		event: MessageEvent<PreviewTextWorkerRequest>,
	): Promise<void> => {
		const message = event.data;

		if (message.type === "dispose") {
			close();
			return;
		}

		try {
			let result;
			if (message.type === "get-content-snippet") {
				result = getContentSnippet(
					message.content,
					message.settings,
					message.searchQuery,
					message.searchOptions,
				);
			} else if (message.type === "transform-content") {
				result = transformContentForPreview(
					message.content,
					message.settings,
					message.options,
				);
			} else if (message.type === "highlight-html") {
				result = highlightSearchMatchesInHtml(
					message.content,
					message.searchQuery,
				);
			} else if (message.type === "extract-first-embedded-media") {
				result = await extractFirstEmbeddedMedia(message.content, {
					maxScanChars: message.maxScanChars,
				});
			} else if (message.type === "canvas-to-search-text") {
				result = canvasToSearchText(message.input);
			} else if (message.type === "find-first-allowed-fenced-code-block") {
				result = await findFirstAllowedFencedCodeBlock(
					message.content,
					new Set(message.allowedTypes),
					{ maxScanChars: message.maxScanChars },
				);
			}

			const response: PreviewTextWorkerResponse = {
				type: "result",
				requestId: message.requestId,
				result,
			};
			postMessage(response);
		} catch (error) {
			const response: PreviewTextWorkerResponse = {
				type: "error",
				requestId: message.requestId,
				message: errorMessage(error),
			};
			postMessage(response);
		}
	};
}
