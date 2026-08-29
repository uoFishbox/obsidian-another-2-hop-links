import type { TFile } from "obsidian";
import type { PreviewData, PreviewRequestOptions } from "../types";
import type { PreviewContext } from "./previewContext";
import {
	buildPreviewGenerationKey,
	createPreviewGenerationCache,
	disposePreviewData,
	getPreviewDataSize,
} from "./previewCache";
import { clearMathRenderQueue } from "../renderers/mathRenderQueue";
import { clearVideoPreviewQueue } from "../renderers/videoPreviewRenderer";
import { createAbortError } from "./previewAbort";
import { createPreviewContext } from "./previewContext";
import { createPreviewQueue } from "./previewQueue";
import { resolvePreview as resolveDefaultPreview } from "./previewPipeline";
import {
	createPreviewRenderSettings,
	type PreviewRenderSettings,
} from "./previewRenderSettings";
import {
	attachSharedCaller,
	createSharedAbortableRequest,
	type SharedAbortableRequest,
} from "./sharedAbortableRequest";
import type { PluginSettings } from "settings/model";
import type { App } from "obsidian";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";

export type PreviewResolver = (
	file: TFile,
	context: PreviewContext,
	signal?: AbortSignal,
) => Promise<PreviewData>;

export interface IPreviewService {
	getPreview(
		file: TFile,
		signal?: AbortSignal,
		options?: PreviewRequestOptions,
	): Promise<PreviewData>;
}

type InFlightRequest = SharedAbortableRequest<PreviewData> & {
	readonly cacheKey: string;
};

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
		const renderSettings =
			requestOptions.renderSettings ?? createPreviewRenderSettings(settings);
		const cacheKey = buildPreviewGenerationKey(
			file,
			renderSettings,
			requestOptions.cacheRevision,
		);
		const cached = cache.get(cacheKey);
		if (cached) return cached;

		const existingRequest = inFlightRequests.get(cacheKey);
		if (existingRequest && !existingRequest.controller.signal.aborted) {
			return attachSharedCaller(existingRequest, signal);
		}

		const request = createInFlightRequest(
			file,
			applyRequestedRenderSettings(settings, renderSettings),
			cacheKey,
		);
		inFlightRequests.set(cacheKey, request);
		return attachSharedCaller(request, signal);
	}

	function createInFlightRequest(
		file: TFile,
		settings: PluginSettings,
		cacheKey: string,
	): InFlightRequest {
		const request: InFlightRequest = {
			cacheKey,
			...createSharedAbortableRequest((signal) =>
				queue.enqueue(
					() => generatePreview(file, settings, signal, cacheKey),
					signal,
				),
			),
		};

		void request.promise.then(
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
		clearCache: () => cache.clear(),
		dispose,
	};
}

function applyRequestedRenderSettings(
	settings: PluginSettings,
	renderSettings: PreviewRenderSettings,
): PluginSettings {
	return {
		...settings,
		...renderSettings,
	};
}
