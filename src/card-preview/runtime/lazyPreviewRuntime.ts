import type { App, TFile } from "obsidian";
import type { PluginSettings } from "settings/model";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import type {
	DisposablePreviewService,
	IPreviewService,
} from "card-preview/pipeline/createPreviewService";
import type { PreviewRequestOptions } from "card-preview/types";
import type { RawContentLoader } from "card-preview/pipeline/rawContentReader";
import type {
	PreviewRuntime,
	PreviewRuntimeOptions,
	PreviewRuntimeSurfaceOptions,
} from "./previewRuntime";
import type { VirtualPreviewSurface } from "card-preview/scheduling/virtualPreviewSurface";
import { DISABLED_PREVIEW_SURFACE } from "./disabledPreviewSurface";

export interface LazyPreviewServiceOptions {
	readonly vault: IVault;
	readonly metadataCache: IMetadataCache;
	readonly app: App;
	readonly getSettings: () => PluginSettings;
}

/** Defers the preview pipeline until a card actually requests preview data. */
export function createLazyPreviewService(
	options: LazyPreviewServiceOptions,
): DisposablePreviewService {
	let service: DisposablePreviewService | undefined;

	function getService(): DisposablePreviewService {
		if (!service) {
			const { createPreviewService } =
				require("card-preview/pipeline/createPreviewService") as typeof import("card-preview/pipeline/createPreviewService");
			service = createPreviewService(options);
		}
		return service;
	}

	const getPreview: IPreviewService["getPreview"] = (
		file: TFile,
		signal?: AbortSignal,
		requestOptions?: PreviewRequestOptions,
	) => getService().getPreview(file, signal, requestOptions);
	const getRawContent: RawContentLoader = (file, signal) =>
		getService().getRawContent(file, signal);

	return {
		getPreview,
		getRawContent,
		clearCache: () => service?.clearCache(),
		dispose: () => {
			service?.dispose();
			service = undefined;
		},
	};
}

/** Defers preview renderers, schedulers, and caches until the first surface. */
export function createLazyPreviewRuntime(
	options: PreviewRuntimeOptions,
): PreviewRuntime {
	let runtime: PreviewRuntime | undefined;
	let disposed = false;

	function createSurface(
		surfaceOptions: PreviewRuntimeSurfaceOptions,
	): VirtualPreviewSurface {
		if (disposed) return DISABLED_PREVIEW_SURFACE;
		if (!runtime) {
			const { createPreviewRuntime } =
				require("./previewRuntime") as typeof import("./previewRuntime");
			runtime = createPreviewRuntime(options);
		}
		return runtime.createSurface(surfaceOptions);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		runtime?.dispose();
		runtime = undefined;
	}

	return { createSurface, dispose };
}
