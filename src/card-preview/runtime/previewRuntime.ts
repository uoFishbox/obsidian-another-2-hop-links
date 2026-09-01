import type { App } from "obsidian";
import { resolveWorkspaceWindow } from "obsidian-integration/workspace/workspaceDocuments";
import {
	createPreviewDomCommitScheduler,
	type PreviewDomCommitScheduler,
} from "card-preview/scheduling/previewDomCommitScheduler";
import {
	createVirtualPreviewSurface,
	type VirtualPreviewSurface,
} from "card-preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "shared/ui/scheduling/frameCoordinator";
import {
	createCardPreviewRenderer,
	type CardPreviewLoader,
	type CardPreviewRendererOptions,
} from "card-preview/ui/cardPreviewRenderer";
import { createCardPreviewSharedCache } from "card-preview/ui/cardPreviewSharedCache";
import { createPreviewRenderQueue } from "card-preview/renderers/previewRenderQueue";
import type { RawContentLoader } from "card-preview/pipeline/rawContentReader";

/** Configuration shared by every preview surface owned by one plugin load. */
export interface PreviewRuntimeOptions {
	readonly app: App;
	readonly getPreview: CardPreviewLoader;
	readonly getRawContent?: RawContentLoader;
	readonly getDomCommitsPerSecond?: () => number;
	readonly getImageDomCommitsPerSecond?: () => number;
}

/** Per-surface values which are expected to vary with the current view. */
export interface PreviewRuntimeSurfaceOptions {
	readonly frameCoordinator: VirtualFrameCoordinator;
	readonly resolveSearchMatchOffset?: CardPreviewRendererOptions["resolveSearchMatchOffset"];
}

/**
 * Plugin-owned entry point for all preview surfaces.
 *
 * The runtime gives every consumer the same preview data source, shared
 * backpressure/admission policy, and teardown boundary. View-specific search
 * and render revision inputs remain explicit surface options because they
 * belong to the view.
 */
export interface PreviewRuntime {
	createSurface(options: PreviewRuntimeSurfaceOptions): VirtualPreviewSurface;
	dispose(): void;
}

/** Creates the preview runtime for one plugin load. */
export function createPreviewRuntime(options: PreviewRuntimeOptions): PreviewRuntime {
	// Token-delay timers and non-surface render work follow the workspace window
	// receiving input so popout work does not fall back to a throttled main realm.
	const resolveSchedulingWindow = (): Window | null =>
		resolveWorkspaceWindow(options.app.workspace);
	const domCommitScheduler: PreviewDomCommitScheduler =
		createPreviewDomCommitScheduler(resolveSchedulingWindow);
	const previewRenderQueue = createPreviewRenderQueue({
		getSchedulingWindow: resolveSchedulingWindow,
	});
	const sharedCache = createCardPreviewSharedCache();
	const surfaces = new Set<VirtualPreviewSurface>();
	let disposed = false;

	function createSurface(
		surfaceOptions: PreviewRuntimeSurfaceOptions,
	): VirtualPreviewSurface {
		if (disposed) {
			return DISABLED_PREVIEW_SURFACE;
		}

		const domCommitScope = domCommitScheduler.createScope({
			frameCoordinator: surfaceOptions.frameCoordinator,
			getCommitsPerSecond: options.getDomCommitsPerSecond,
		});
		const imageDomCommitScope = domCommitScheduler.createScope({
			frameCoordinator: surfaceOptions.frameCoordinator,
			getCommitsPerSecond: options.getImageDomCommitsPerSecond,
		});
		const surface = createVirtualPreviewSurface({
			frameCoordinator: surfaceOptions.frameCoordinator,
			prefetchPreview: async (request, signal) => {
				if (request.previewOverride) return;
				await options.getPreview(request.file, signal, {
					cacheRevision: request.previewCacheRevision,
					renderSettings: request.settings,
				});
			},
			createRenderer: () =>
				createCardPreviewRenderer({
					app: options.app,
					getPreview: options.getPreview,
					getRawContent: options.getRawContent,
					enqueuePreviewRender: previewRenderQueue.enqueue,
					sharedCache,
					resolveSearchMatchOffset: surfaceOptions.resolveSearchMatchOffset,
					domCommitScope,
					imageDomCommitScope,
				}),
		});
		let managedSurface!: VirtualPreviewSurface;
		managedSurface = {
			...surface,
			dispose: () => {
				if (!surfaces.delete(managedSurface)) return;
				surface.dispose();
				domCommitScope.dispose();
				imageDomCommitScope.dispose();
			},
		};
		surfaces.add(managedSurface);
		return managedSurface;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const surface of surfaces) surface.dispose();
		surfaces.clear();
		previewRenderQueue.dispose();
		sharedCache.clear();
		// These schedulers are shared by renderers created by this runtime. Their
		// lifetime must end with the plugin, not with an individual idle queue.
		domCommitScheduler.dispose();
	}

	return { createSurface, dispose };
}

/** Stateless preview surface used when preview rendering is unavailable. */
export const DISABLED_PREVIEW_SURFACE: VirtualPreviewSurface = {
	registerHost: () => ({ dispose: () => {} }),
	publish: () => {},
	dispose: () => {},
};
