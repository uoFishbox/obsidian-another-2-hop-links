import type { TFile } from "obsidian";
import type { PreviewData, PreviewRequestOptions } from "../types";
import type { PreviewContext } from "./previewContext";
import type { PreviewQueueListener } from "./previewQueue";
import {
	buildPreviewGenerationKey,
	createPreviewGenerationCache,
	disposePreviewData,
	getPreviewDataSize,
} from "./previewCache";
import { clearMathRenderQueue } from "../renderers/mathRenderQueue";
import { clearVideoPreviewQueue } from "../renderers/videoPreviewRenderer";
import { createAbortError, isAbortError } from "./previewAbort";
import { createPreviewContext } from "./previewContext";
import { createPreviewQueue } from "./previewQueue";
import { resolvePreview as resolveDefaultPreview } from "./previewPipeline";
import { createPreviewRenderSettings } from "./previewRenderSettings";
import type { PluginSettings } from "settings/model";
import type { App } from "obsidian";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";

export type PreviewResolver = (
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
) => Promise<PreviewData>;

export interface PreviewQueueMetrics {
	readonly queued: number;
	readonly active: number;
}

export interface IPreviewService {
	getPreview(
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	): Promise<PreviewData>;
	getVisibleQueueSize(): number;
	getActiveVisiblePreviewCount(): number;
	getOutstandingVisiblePreviewCount(): number;
	subscribeVisiblePreviewQueue(
		listener: (metrics: PreviewQueueMetrics) => void,
	): () => void;
}

interface InFlightRequest {
	readonly cacheKey: string;
	callerCount: number;
	readonly controller: AbortController;
	readonly promise: Promise<PreviewData>;
}

interface PreviewServiceOptions {
	readonly vault: IVault;
	readonly metadataCache: IMetadataCache;
	readonly app: App;
	readonly getSettings: () => PluginSettings;
}

export interface DisposablePreviewService extends IPreviewService {
	clearCache(): void;
	dispose(): void;
}

/** Creates the preview generation/cache boundary for one plugin load. */
export function createPreviewService(
	options: PreviewServiceOptions,
	resolvePreview: PreviewResolver = resolveDefaultPreview,
): DisposablePreviewService {
	const cache = createPreviewGenerationCache();
	const inFlightRequests = new Map<string, InFlightRequest>();
	const queue = createPreviewQueue();

	async function getPreview(
		file: TFile,
		signal?: AbortSignal,
		requestOptions: PreviewRequestOptions = {},
	): Promise<PreviewData> {
		if (signal?.aborted) throw createAbortError();

		const settings = options.getSettings();
		const cacheKey = buildPreviewGenerationKey(
			file,
			createPreviewRenderSettings(settings),
			requestOptions.cacheRevision,
		);
		const cached = cache.get(cacheKey);
		if (cached) return cached;

		const existingRequest = inFlightRequests.get(cacheKey);
		if (
			existingRequest &&
			!(
				existingRequest.callerCount === 0 &&
				existingRequest.controller.signal.aborted
			)
		) {
			return attachCallerToRequest(existingRequest, signal);
		}

		const request = createInFlightRequest(file, settings, cacheKey);
		inFlightRequests.set(cacheKey, request);
		return attachCallerToRequest(request, signal);
	}

	function createInFlightRequest(
		file: TFile,
		settings: PluginSettings,
		cacheKey: string,
	): InFlightRequest {
		const controller = new AbortController();
		const promise = queue.enqueue(
			() => generatePreview(file, settings, controller.signal, cacheKey),
			controller.signal,
		);
		const request: InFlightRequest = {
			cacheKey,
			callerCount: 0,
			controller,
			promise,
		};

		void promise.then(
			() => finalizeInFlightRequest(request),
			() => finalizeInFlightRequest(request),
		);
		return request;
	}

	async function generatePreview(
		file: TFile,
		settings: PluginSettings,
		signal: AbortSignal,
		cacheKey: string,
	): Promise<PreviewData> {
		const context = createPreviewContext(
			file,
			options.vault,
			options.metadataCache,
			options.app,
			settings,
			signal,
		);
		const result = await resolvePreview(file, context, signal);
		if (signal.aborted) throw createAbortError();
		cache.set(cacheKey, result, getPreviewDataSize(result), () =>
			disposePreviewData(result),
		);
		return result;
	}

	function attachCallerToRequest(
		request: InFlightRequest,
		signal?: AbortSignal,
	): Promise<PreviewData> {
		if (signal?.aborted) return Promise.reject(createAbortError());
		request.callerCount += 1;

		return new Promise<PreviewData>((resolve, reject) => {
			let settled = false;
			let onAbort = () => {};
			const settle = (handler: () => void): void => {
				if (settled) return;
				settled = true;
				if (signal) signal.removeEventListener("abort", onAbort);
				releaseCaller(request);
				handler();
			};
			onAbort = () => settle(() => reject(createAbortError()));
			if (signal) signal.addEventListener("abort", onAbort, { once: true });

			request.promise.then(
				(data) => {
					if (signal?.aborted) settle(() => reject(createAbortError()));
					else settle(() => resolve(data));
				},
				(error) => {
					if (signal?.aborted && !isAbortError(error)) {
						settle(() => reject(createAbortError()));
					} else {
						settle(() => reject(error));
					}
				},
			);
		});
	}

	function releaseCaller(request: InFlightRequest): void {
		request.callerCount = Math.max(request.callerCount - 1, 0);
		if (
			request.callerCount === 0 &&
			inFlightRequests.get(request.cacheKey) === request
		) {
			request.controller.abort();
		}
	}

	function finalizeInFlightRequest(request: InFlightRequest): void {
		if (inFlightRequests.get(request.cacheKey) === request) {
			inFlightRequests.delete(request.cacheKey);
		}
	}

	function dispose(): void {
		for (const request of inFlightRequests.values()) request.controller.abort();
		inFlightRequests.clear();
		queue.shutdown();
		cache.clear();
		clearMathRenderQueue();
		clearVideoPreviewQueue();
	}

	return {
		getPreview,
		getVisibleQueueSize: () => queue.getQueuedCount(),
		getActiveVisiblePreviewCount: () => queue.getActiveCount(),
		getOutstandingVisiblePreviewCount: () => queue.getOutstandingCount(),
		subscribeVisiblePreviewQueue: (listener: PreviewQueueListener) =>
			queue.subscribe(listener),
		clearCache: () => cache.clear(),
		dispose,
	};
}
