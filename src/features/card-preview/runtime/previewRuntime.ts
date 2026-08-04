import type { App } from "obsidian";
import {
	createPreviewActivationScheduler,
	type PreviewBackpressureChangeListener,
	type PreviewActivationScheduler,
} from "features/card-preview/scheduling/previewActivationScheduler";
import {
	createPreviewDomCommitScheduler,
	type PreviewDomCommitScheduler,
} from "features/card-preview/scheduling/previewDomCommitScheduler";
import {
	createVirtualPreviewSurface,
	type VirtualPreviewSurface,
} from "features/card-preview/scheduling/virtualPreviewSurface";
import type { VirtualFrameCoordinator } from "ui/virtualization/scheduling/frameCoordinator";
import {
	createCardPreviewRenderer,
	type CardPreviewLoader,
	type CardPreviewRenderer,
	type CardPreviewRendererOptions,
} from "features/card-preview/ui/cardPreviewRenderer";
import { createCardPreviewSharedCache } from "features/card-preview/ui/cardPreviewSharedCache";

/** Configuration shared by every preview surface owned by one plugin load. */
export interface PreviewRuntimeOptions {
	readonly app: App;
	readonly getPreview: CardPreviewLoader;
	readonly getOutstandingPreviewJobCount?: () => number;
	readonly subscribeBackpressure?: (
		listener: PreviewBackpressureChangeListener,
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
	"app" | "getPreview" | "sharedCache" | "domCommitScope"
> & {
	readonly frameCoordinator?: VirtualFrameCoordinator;
	readonly getDomCommitsPerSecond?: () => number;
};

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
			getOutstandingPreviewJobCount: options.getOutstandingPreviewJobCount,
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

		const domCommitScope = domCommitScheduler.createScope({
			frameCoordinator: surfaceOptions.frameCoordinator,
			getCommitsPerSecond: options.getDomCommitsPerSecond,
		});
		const surface = createVirtualPreviewSurface({
			frameCoordinator: surfaceOptions.frameCoordinator,
			activationScheduler,
			createRenderer: () =>
				createCardPreviewRenderer({
					app: options.app,
					getPreview: options.getPreview,
					sharedCache,
					resolveSearchMatchPosition:
						surfaceOptions.resolveSearchMatchPosition,
					domCommitScope,
				}),
		});
		let managedSurface!: VirtualPreviewSurface;
		managedSurface = {
			...surface,
			dispose: () => {
				if (!surfaces.delete(managedSurface)) return;
				surface.dispose();
				domCommitScope.dispose();
			},
		};
		surfaces.add(managedSurface);
		return managedSurface;
	}

	function createRenderer(
		rendererOptions: PreviewRuntimeRendererOptions,
	): CardPreviewRenderer {
		if (disposed) return DISABLED_CARD_PREVIEW_RENDERER;
		const { frameCoordinator, getDomCommitsPerSecond, ...rest } = rendererOptions;
		const domCommitScope = domCommitScheduler.createScope({
			frameCoordinator,
			getCommitsPerSecond:
				getDomCommitsPerSecond ?? options.getDomCommitsPerSecond,
		});
		return createCardPreviewRenderer({
			...rest,
			app: options.app,
			getPreview: options.getPreview,
			sharedCache,
			domCommitScope,
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
	beginBindings: () => {},
	bindSlot: () => {},
	endBindings: () => {},
	setActiveRange: () => {},
	dispose: () => {},
};

const DISABLED_CARD_PREVIEW_RENDERER: CardPreviewRenderer = () => () => {};
