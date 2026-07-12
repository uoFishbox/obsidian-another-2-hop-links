import { canvasToSearchText } from "./canvasText";
import { findFirstAllowedFencedCodeBlock } from "./fencedCodeBlocks";
import { extractFirstEmbeddedMedia } from "./mediaExtractor";
import { getContentSnippet, renderPreparedContentSnippet } from "./snippetExtractor";
import { highlightSearchMatchesInHtml } from "./searchHighlighter";
import { transformContentForPreview } from "./textTransformUtils";
import type {
	PreviewTextWorkerRequest,
	PreviewTextWorkerResponse,
	PreviewTextWorkerResult,
} from "./previewTextWorkerTypes";

export {};

type ExecutablePreviewTextWorkerRequest = Exclude<
	PreviewTextWorkerRequest,
	{ type: "cancel" } | { type: "dispose" }
>;

const queuedRequests: ExecutablePreviewTextWorkerRequest[] = [];
const cancelledRequestIds = new Set<number>();
let isProcessingRequest = false;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}

function executeRequest(
	message: ExecutablePreviewTextWorkerRequest,
): PreviewTextWorkerResult | Promise<PreviewTextWorkerResult> {
	switch (message.type) {
		case "get-content-snippet":
			return getContentSnippet(
				message.content,
				message.settings,
				message.searchQuery,
				message.searchOptions,
			);
		case "render-prepared-content-snippet":
			return renderPreparedContentSnippet(message.prepared, message.settings);
		case "transform-content":
			return transformContentForPreview(
				message.content,
				message.settings,
				message.options,
			);
		case "highlight-html":
			return highlightSearchMatchesInHtml(message.content, message.searchQuery);
		case "extract-first-embedded-media":
			return extractFirstEmbeddedMedia(message.content, {
				maxScanChars: message.maxScanChars,
			});
		case "canvas-to-search-text":
			return canvasToSearchText(message.input);
		case "find-first-allowed-fenced-code-block":
			return findFirstAllowedFencedCodeBlock(
				message.content,
				new Set(message.allowedTypes),
				{ maxScanChars: message.maxScanChars },
			);
		default: {
			const _exhaustive: never = message;
			return _exhaustive;
		}
	}
}

function completeRequest(
	message: ExecutablePreviewTextWorkerRequest,
	result: PreviewTextWorkerResult,
): void {
	if (cancelledRequestIds.has(message.requestId)) {
		cancelledRequestIds.delete(message.requestId);
		return;
	}

	const response: PreviewTextWorkerResponse = {
		type: "result",
		requestId: message.requestId,
		result,
	};
	postMessage(response);
}

function failRequest(
	message: ExecutablePreviewTextWorkerRequest,
	error: unknown,
): void {
	if (cancelledRequestIds.has(message.requestId)) {
		cancelledRequestIds.delete(message.requestId);
		return;
	}

	const response: PreviewTextWorkerResponse = {
		type: "error",
		requestId: message.requestId,
		message: errorMessage(error),
	};
	postMessage(response);
}

function finishAsyncRequest(): void {
	isProcessingRequest = false;
	processQueuedRequests();
}

function processQueuedRequests(): void {
	if (isProcessingRequest) {
		return;
	}

	while (queuedRequests.length > 0) {
		const message = queuedRequests.shift();
		if (!message) {
			return;
		}
		if (cancelledRequestIds.has(message.requestId)) {
			cancelledRequestIds.delete(message.requestId);
			continue;
		}

		try {
			const result = executeRequest(message);
			if (!isPromiseLike(result)) {
				completeRequest(message, result);
				continue;
			}

			isProcessingRequest = true;
			result
				.then(
					(resolvedResult) => completeRequest(message, resolvedResult),
					(error) => failRequest(message, error),
				)
				.finally(finishAsyncRequest);
			return;
		} catch (error) {
			failRequest(message, error);
		}
	}
}

if (typeof self !== "undefined") {
	self.onmessage = (event: MessageEvent<PreviewTextWorkerRequest>): void => {
		const message = event.data;

		if (message.type === "dispose") {
			queuedRequests.length = 0;
			cancelledRequestIds.clear();
			close();
			return;
		}

		if (message.type === "cancel") {
			cancelledRequestIds.add(message.requestId);
			const queuedIndex = queuedRequests.findIndex(
				(request) => request.requestId === message.requestId,
			);
			if (queuedIndex !== -1) {
				queuedRequests.splice(queuedIndex, 1);
				cancelledRequestIds.delete(message.requestId);
			}
			return;
		}

		queuedRequests.push(message);
		processQueuedRequests();
	};
}
