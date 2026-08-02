import type { App } from "obsidian";
import {
	createPreviewActivationScheduler,
	type PreviewBackpressure,
	type PreviewBackpressureListener,
	type PreviewActivationScheduler,
} from "features/preview/scheduling/previewActivationScheduler";
import {
	createPreviewDomCommitScheduler,
	type PreviewDomCommitScheduler,
} from "features/preview/scheduling/previewDomCommitScheduler";
import {
	createVirtualPreviewSurface,
	type VirtualPreviewSurface,
} from "features/preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	createCardPreviewRenderer,
	type CardPreviewLoader,
	type CardPreviewRenderer,
	type CardPreviewRendererOptions,
} from "features/preview/ui/cardPreviewRenderer";
import { createCardPreviewSharedCache } from "features/preview/ui/cardPreviewSharedCache";

/** Configuration shared by every preview surface owned by one plugin load. */
export interface PreviewRuntimeOptions {
	readonly app: App;
	readonly getPreview: CardPreviewLoader;
	readonly getBackpressure?: () => PreviewBackpressure;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureListener,
	) => () => void;
	readonly getActivationsPerSecond?: () => number;
	readonly getDomCommitsPerSecond?: () => number;
}

/** Per-surface values which are expected to vary with the current view. */
export interface PreviewRuntimeSurfaceOptions {
	readonly frameCoordinator?: VirtualFrameCoordinator;
	readonly resolveSearchMatchPosition?: CardPreviewRendererOptions["resolveSearchMatchPosition"];
}

export type PreviewRuntimeRendererOptions = Omit<
	CardPreviewRendererOptions,
	"app" | "getPreview" | "sharedCache" | "domCommitScheduler"
>;

/**
 * Plugin-owned entry point for all preview surfaces and renderers.
 *
 * The runtime gives every consumer the same preview data source, shared
 * backpressure/admission policy, and teardown boundary. View-specific search
 * and render revision inputs remain explicit surface options because they
 * belong to the view.
 */
export interface PreviewRuntime {
	createSurface(options: PreviewRuntimeSurfaceOptions): VirtualPreviewSurface;
	createRenderer(options: PreviewRuntimeRendererOptions): CardPreviewRenderer;
	dispose(): void;
}

/** Creates the preview runtime for one plugin load. */
export function createPreviewRuntime(options: PreviewRuntimeOptions): PreviewRuntime {
	const activationScheduler: PreviewActivationScheduler =
		createPreviewActivationScheduler({
			getBackpressure: options.getBackpressure,
			subscribeBackpressure: options.subscribeBackpressure,
			getActivationsPerSecond: options.getActivationsPerSecond,
		});
	const domCommitScheduler: PreviewDomCommitScheduler =
		createPreviewDomCommitScheduler();
	const sharedCache = createCardPreviewSharedCache();
	const surfaces = new Set<VirtualPreviewSurface>();
	let disposed = false;

	function createSurface(
		surfaceOptions: PreviewRuntimeSurfaceOptions,
	): VirtualPreviewSurface {
		if (disposed) {
			return DISABLED_PREVIEW_SURFACE;
		}

		const surface = createVirtualPreviewSurface({
			frameCoordinator: surfaceOptions.frameCoordinator,
			activationScheduler,
			createRenderer: () =>
				createCardPreviewRenderer({
					app: options.app,
					getPreview: options.getPreview,
					sharedCache,
					frameCoordinator: surfaceOptions.frameCoordinator,
					getDomCommitsPerSecond: options.getDomCommitsPerSecond,
					resolveSearchMatchPosition:
						surfaceOptions.resolveSearchMatchPosition,
					domCommitScheduler,
				}),
		});
		let managedSurface!: VirtualPreviewSurface;
		managedSurface = {
			...surface,
			dispose: () => {
				if (!surfaces.delete(managedSurface)) return;
				surface.dispose();
			},
		};
		surfaces.add(managedSurface);
		return managedSurface;
	}

	function createRenderer(
		rendererOptions: PreviewRuntimeRendererOptions,
	): CardPreviewRenderer {
		if (disposed) return DISABLED_CARD_PREVIEW_RENDERER;
		return createCardPreviewRenderer({
			...rendererOptions,
			app: options.app,
			getPreview: options.getPreview,
			sharedCache,
			getDomCommitsPerSecond:
				rendererOptions.getDomCommitsPerSecond ??
				options.getDomCommitsPerSecond,
			domCommitScheduler,
		});
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		for (const surface of surfaces) surface.dispose();
		surfaces.clear();
		sharedCache.clear();
		// These schedulers are shared by renderers created by this runtime. Their
		// lifetime must end with the plugin, not with an individual idle queue.
		activationScheduler.dispose();
		domCommitScheduler.dispose();
	}

	return { createSurface, createRenderer, dispose };
}

/** Stateless preview surface used when preview rendering is unavailable. */
export const DISABLED_PREVIEW_SURFACE: VirtualPreviewSurface = {
	registerHost: () => ({ dispose: () => {} }),
	publish: () => {},
	dispose: () => {},
};

const DISABLED_CARD_PREVIEW_RENDERER: CardPreviewRenderer = () => () => {};
