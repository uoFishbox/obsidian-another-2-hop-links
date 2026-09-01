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
import { readRawContent, type RawContentLoader } from "./rawContentReader";
import { createSizedLRUCache, stringBytes } from "shared/cache/sizedLRUCache";

const RAW_CONTENT_CACHE_MAX_BYTES = 4 * 1024 * 1024;
const RAW_CONTENT_CACHE_KEY_SEPARATOR = "\0";

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
	readonly getRawContent: RawContentLoader;
}

type InFlightRequest = SharedAbortableRequest<PreviewData> & {
	readonly cacheKey: string;
};

type InFlightRawContentRequest = SharedAbortableRequest<string> & {
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
	const rawContentCache = createSizedLRUCache<string, string>(
		RAW_CONTENT_CACHE_MAX_BYTES,
	);
	const rawContentInFlight = new Map<string, InFlightRawContentRequest>();
	const queue = createPreviewQueue();

	const getRawContent: RawContentLoader = async (file, signal) => {
		if (signal?.aborted) throw createAbortError();
		const cacheKey = buildRawContentCacheKey(file);
		const cached = rawContentCache.get(cacheKey);
		if (cached !== undefined) return cached;

		const existingRequest = rawContentInFlight.get(cacheKey);
		if (existingRequest && !existingRequest.controller.signal.aborted) {
			return attachSharedCaller(existingRequest, signal);
		}
		if (existingRequest) rawContentInFlight.delete(cacheKey);

		const request: InFlightRawContentRequest = {
			cacheKey,
			...createSharedAbortableRequest((sharedSignal) =>
				readRawContent(file, options.vault, sharedSignal),
			),
		};
		rawContentInFlight.set(cacheKey, request);
		void request.promise.then(
			(content) => {
				if (!request.controller.signal.aborted) {
					rawContentCache.set(cacheKey, content, stringBytes(content));
				}
				finalizeRawContentRequest(request);
			},
			() => finalizeRawContentRequest(request),
		);
		return attachSharedCaller(request, signal);
	};

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
			getRawContent,
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

	function finalizeRawContentRequest(request: InFlightRawContentRequest): void {
		if (rawContentInFlight.get(request.cacheKey) === request) {
			rawContentInFlight.delete(request.cacheKey);
		}
	}

	function clearCache(): void {
		cache.clear();
		rawContentCache.clear();
	}

	function dispose(): void {
		for (const request of inFlightRequests.values()) request.controller.abort();
		inFlightRequests.clear();
		for (const request of rawContentInFlight.values()) request.controller.abort();
		rawContentInFlight.clear();
		queue.shutdown();
		cache.clear();
		rawContentCache.clear();
		clearMathRenderQueue();
		clearVideoPreviewQueue();
	}

	return {
		getPreview,
		getRawContent,
		clearCache,
		dispose,
	};
}

function buildRawContentCacheKey(file: TFile): string {
	return `${file.path}${RAW_CONTENT_CACHE_KEY_SEPARATOR}${file.stat.mtime}`;
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
