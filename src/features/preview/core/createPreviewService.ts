import type { App, TFile } from "obsidian";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { IPreviewService } from "types/services";
import type { PluginSettings } from "features/settings/model";
import type { PreviewData, PreviewRequestOptions } from "../public-types";
import type { PreviewStrategy } from "./PreviewStrategy";
import type { PreviewQueueTask } from "./previewQueue";
import {
	buildPreviewGenerationKey,
	createPreviewGenerationCache,
} from "./previewCache";
import { clearMathRenderQueue } from "../renderers/mathRenderQueue";
import { clearVideoPreviewQueue } from "../renderers/videoPreviewRenderer";
import { createAbortError, isAbortError } from "./previewAbort";
import { createDefaultPreviewStrategies } from "./defaultPreviewStrategies";
import { createPreviewContext } from "./previewContext";
import { createPreviewQueue } from "./previewQueue";
import { runPreviewPipeline } from "./previewPipeline";

interface InFlightRequest {
	cacheKey: string;
	callerCount: number;
	controller: AbortController;
	promise: Promise<PreviewData>;
}

export class PreviewService {
	private strategies: PreviewStrategy[];
	private cache = createPreviewGenerationCache();
	private inFlightRequests = new Map<string, InFlightRequest>();
	private queue = createPreviewQueue();

	constructor(strategies?: PreviewStrategy[]) {
		this.strategies = strategies ?? createDefaultPreviewStrategies();
		this.ensureStarted();
	}

	public ensureStarted(): void {}

	public dispose(): void {
		this.shutdown();
	}

	public getVisibleQueueSize(): number {
		return this.queue.getSize();
	}

	public getActiveVisiblePreviewCount(): number {
		return this.queue.getActiveCount();
	}

	public shutdown(): void {
		for (const request of this.inFlightRequests.values()) {
			request.controller.abort();
		}
		this.inFlightRequests.clear();
		this.queue.shutdown();
		this.cache.clear();
		clearMathRenderQueue();
		clearVideoPreviewQueue();
	}

	public clearCache(): void {
		this.cache.clear();
	}

	public async getPreview(
		file: TFile,
		vault: IVault,
		metadataCache: IMetadataCache,
		app?: App,
		settings?: PluginSettings,
		signal?: AbortSignal,
		options: PreviewRequestOptions = {},
	): Promise<PreviewData> {
		this.ensureStarted();
		if (signal?.aborted) {
			throw createAbortError();
		}

		const cacheKey = buildPreviewGenerationKey(
			file,
			settings,
			options.cacheRevision,
		);
		const cached = this.cache.get(cacheKey);

		if (cached) {
			return cached;
		}

		const existingRequest = this.inFlightRequests.get(cacheKey);
		if (
			existingRequest &&
			!(
				existingRequest.callerCount === 0 &&
				existingRequest.controller.signal.aborted
			)
		) {
			return this.attachCallerToRequest(existingRequest, signal);
		}

		const request = this.createInFlightRequest(
			file,
			vault,
			metadataCache,
			app,
			settings,
			cacheKey,
		);
		this.inFlightRequests.set(cacheKey, request);
		return this.attachCallerToRequest(request, signal);
	}

	private async generatePreview(
		file: TFile,
		vault: IVault,
		metadataCache: IMetadataCache,
		app: App | undefined,
		settings: PluginSettings | undefined,
		signal: AbortSignal | undefined,
		cacheKey: string,
	): Promise<PreviewData> {
		const context = createPreviewContext(
			file,
			vault,
			metadataCache,
			app,
			settings,
			signal,
		);

		return runPreviewPipeline(
			file,
			context,
			this.strategies,
			this.cache,
			cacheKey,
			signal,
		);
	}

	private createInFlightRequest(
		file: TFile,
		vault: IVault,
		metadataCache: IMetadataCache,
		app: App | undefined,
		settings: PluginSettings | undefined,
		cacheKey: string,
	): InFlightRequest {
		const controller = new AbortController();
		const task: PreviewQueueTask = {
			cancelled: false,
			cleanup: () => {},
			reject: () => {},
			resolve: () => {},
			run: async () =>
				this.generatePreview(
					file,
					vault,
					metadataCache,
					app,
					settings,
					controller.signal,
					cacheKey,
				),
			signal: controller.signal,
			started: false,
		};

		const promise = this.queue.enqueue(task);
		const request: InFlightRequest = {
			cacheKey,
			callerCount: 0,
			controller,
			promise,
		};

		void promise.then(
			() => this.finalizeInFlightRequest(request),
			() => this.finalizeInFlightRequest(request),
		);

		return request;
	}

	private attachCallerToRequest(
		request: InFlightRequest,
		signal?: AbortSignal,
	): Promise<PreviewData> {
		if (signal?.aborted) {
			return Promise.reject(createAbortError());
		}

		request.callerCount += 1;

		return new Promise<PreviewData>((resolve, reject) => {
			let settled = false;
			let onAbort = () => {};

			const settle = (handler: () => void): void => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				this.releaseCaller(request);
				handler();
			};

			const cleanup = (): void => {
				if (signal) {
					signal.removeEventListener("abort", onAbort);
				}
			};

			onAbort = (): void => {
				settle(() => reject(createAbortError()));
			};

			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			request.promise.then(
				(data) => {
					if (signal?.aborted) {
						settle(() => reject(createAbortError()));
						return;
					}
					settle(() => resolve(data));
				},
				(error) => {
					if (signal?.aborted && !isAbortError(error)) {
						settle(() => reject(createAbortError()));
						return;
					}
					settle(() => reject(error));
				},
			);
		});
	}

	private releaseCaller(request: InFlightRequest): void {
		request.callerCount = Math.max(request.callerCount - 1, 0);
		if (
			request.callerCount === 0 &&
			this.inFlightRequests.get(request.cacheKey) === request
		) {
			request.controller.abort();
		}
	}

	private finalizeInFlightRequest(request: InFlightRequest): void {
		if (this.inFlightRequests.get(request.cacheKey) === request) {
			this.inFlightRequests.delete(request.cacheKey);
		}
	}
}

export interface PreviewServiceOptions {
	vault: IVault;
	metadataCache: IMetadataCache;
	app: App;
	getSettings(): PluginSettings;
	strategies?: PreviewStrategy[];
}

export interface DisposablePreviewService extends IPreviewService {
	clearCache(): void;
	dispose(): void;
}

/**
 * Creates a preview service owned by a plugin instance.
 */
export function createPreviewService(
	options: PreviewServiceOptions,
): DisposablePreviewService {
	const service = new PreviewService(options.strategies);

	return {
		getPreview: (file, signal, requestOptions) =>
			service.getPreview(
				file,
				options.vault,
				options.metadataCache,
				options.app,
				options.getSettings(),
				signal,
				requestOptions,
			),
		getVisibleQueueSize: () => service.getVisibleQueueSize(),
		getActiveVisiblePreviewCount: () => service.getActiveVisiblePreviewCount(),
		clearCache: () => service.clearCache(),
		dispose: () => service.dispose(),
	};
}
