// @ts-expect-error esbuild-plugin-inline-worker provides this default factory at bundle time.
import createPreviewTextProcessingWorker from "./previewTextProcessing.worker";
import type {
	PreviewTextWorkerRequest,
	PreviewTextWorkerResponse,
	PreviewTextWorkerResult,
} from "./previewTextWorkerTypes";

type PendingRequest = {
	reject: (error: unknown) => void;
	resolve: (result: PreviewTextWorkerResult) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
};

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

type RunnablePreviewTextWorkerRequest = DistributiveOmit<
	Exclude<PreviewTextWorkerRequest, { type: "cancel" }>,
	"requestId"
>;

function buildWorkerRequest(
	request: RunnablePreviewTextWorkerRequest,
	requestId: number,
): PreviewTextWorkerRequest {
	switch (request.type) {
		case "get-content-snippet":
			return {
				type: "get-content-snippet",
				requestId,
				content: request.content,
				settings: request.settings,
				searchQuery: request.searchQuery,
				searchOptions: request.searchOptions,
			};
		case "render-prepared-content-snippet":
			return {
				type: "render-prepared-content-snippet",
				requestId,
				prepared: request.prepared,
				settings: request.settings,
			};
		case "highlight-html":
			return {
				type: "highlight-html",
				requestId,
				content: request.content,
				searchQuery: request.searchQuery,
			};
		case "extract-first-embedded-media":
			return {
				type: "extract-first-embedded-media",
				requestId,
				content: request.content,
				maxScanChars: request.maxScanChars,
			};
		case "canvas-to-search-text":
			return {
				type: "canvas-to-search-text",
				requestId,
				input: request.input,
			};
	}
}

let worker: Worker | null | undefined;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function createAbortError(): DOMException | Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Preview text worker request aborted", "AbortError");
	}

	const error = new Error("Preview text worker request aborted");
	error.name = "AbortError";
	return error;
}

function postCancelRequest(activeWorker: Worker, requestId: number): void {
	try {
		activeWorker.postMessage({ type: "cancel", requestId });
	} catch {
		// The local promise is already being rejected. If the worker is gone,
		// there is no remote queue left to cancel.
	}
}

function getWorker(): Worker | null {
	if (worker !== undefined) {
		return worker;
	}

	try {
		if (typeof Worker === "undefined") {
			worker = null;
			return worker;
		}

		const nextWorker = createPreviewTextProcessingWorker();
		nextWorker.onmessage = (
			event: MessageEvent<PreviewTextWorkerResponse>,
		): void => {
			const message = event.data;
			const pending = pendingRequests.get(message.requestId);
			if (!pending) {
				return;
			}

			pendingRequests.delete(message.requestId);
			if (pending.signal && pending.onAbort) {
				pending.signal.removeEventListener("abort", pending.onAbort);
			}

			if (pending.signal?.aborted) {
				pending.reject(createAbortError());
				return;
			}

			if (message.type === "error") {
				pending.reject(new Error(message.message));
				return;
			}

			pending.resolve(message.result);
		};
		nextWorker.onerror = (event: ErrorEvent): void => {
			const error = new Error(event.message || "Preview text worker failed.");
			for (const [requestId, pending] of pendingRequests) {
				pendingRequests.delete(requestId);
				if (pending.signal && pending.onAbort) {
					pending.signal.removeEventListener("abort", pending.onAbort);
				}
				pending.reject(error);
			}
			worker = null;
		};
		worker = nextWorker;
	} catch {
		worker = null;
	}

	return worker ?? null;
}

export function runPreviewTextWorker(
	request: RunnablePreviewTextWorkerRequest,
	signal?: AbortSignal,
): Promise<PreviewTextWorkerResult> | undefined {
	const activeWorker = getWorker();
	if (!activeWorker) {
		return undefined;
	}

	if (signal?.aborted) {
		return Promise.reject(createAbortError());
	}

	const requestId = nextRequestId++;
	const message = buildWorkerRequest(request, requestId);

	return new Promise((resolve, reject) => {
		const pending: PendingRequest = { resolve, reject, signal };
		if (signal) {
			pending.onAbort = () => {
				pendingRequests.delete(requestId);
				signal.removeEventListener("abort", pending.onAbort!);
				postCancelRequest(activeWorker, requestId);
				reject(createAbortError());
			};
			signal.addEventListener("abort", pending.onAbort, { once: true });
		}

		pendingRequests.set(requestId, pending);
		try {
			activeWorker.postMessage(message);
		} catch (error) {
			pendingRequests.delete(requestId);
			if (signal && pending.onAbort) {
				signal.removeEventListener("abort", pending.onAbort);
			}
			reject(error);
		}
	});
}
