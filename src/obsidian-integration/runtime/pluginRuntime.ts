import type { App, TFile } from "obsidian";
import type { StateEffectType } from "@codemirror/state";
import { IndexUpdateQueue } from "obsidian-integration/lifecycle/IndexUpdateQueue";
import { ComponentController } from "obsidian-integration/lifecycle/ComponentController";
import {
	createViewUpdateOrchestrator,
	type ViewUpdateOrchestrator,
} from "obsidian-integration/lifecycle/viewUpdateOrchestrator";
import {
	createFrameScheduler,
	type FrameScheduler,
} from "obsidian-integration/lifecycle/frameScheduler";
import { RenderedMdElementsRegistry } from "obsidian-integration/markdown/RenderedMdElementsRegistry";
import { DisplayModeController } from "two-hop/display/DisplayModeController";
import { CanvasDropManager } from "obsidian-integration/workspace/CanvasDropHandler";
import { DOMMutationObserver } from "obsidian-integration/observers/DOMMutationObserver";
import { ScrollManager } from "obsidian-integration/workspace/ScrollHistoryState";
import { resolveWorkspaceWindow } from "obsidian-integration/workspace/workspaceDocuments";
import {
	createEmptyViewController,
	type EmptyViewController,
} from "obsidian-integration/lifecycle/emptyViewController";
import { IndexingService } from "indexing/index-service/IndexingService";
import { TwoHopLinkResolver } from "two-hop/resolution/TwoHopLinkResolver";
import type { ResolveTwoHopLinks } from "two-hop/state/TwoHopLinksLoader";
import { createDisplayDataBuilder } from "two-hop/display/displayDataBuilder";
import { getRelevanceLinkTargets } from "two-hop/display/relevanceSort";
import { createLinkContextFactory } from "cards/context/linkContextFactory";
import type { LinkContext } from "cards/context/linkContext";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import { SortService } from "cards/sorting/SortService";
import { MetricProvider } from "cards/sorting/MetricProvider";
import type { SortOption } from "cards/sorting";
import {
	createStylingService,
	type StylingService,
} from "obsidian-integration/link-decoration/stylingService";
import {
	createLinkStatusService,
	type LinkStatusService,
} from "obsidian-integration/link-decoration/linkStatusService";
import {
	createPropertyWidgetStyler,
	type PropertyWidgetStyler,
} from "obsidian-integration/link-decoration/propertyWidgetStyler";
import { KeyboardCardNavigator } from "obsidian-integration/navigation/KeyboardCardNavigator";
import { createKeyboardNavigationSurfaceRegistry } from "obsidian-integration/navigation/keyboardNavigationSurface";
import type { DisposablePreviewService } from "card-preview/pipeline/createPreviewService";
import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
import {
	createLazyPreviewRuntime,
	createLazyPreviewService,
} from "card-preview/runtime/lazyPreviewRuntime";
import { createSettingsSideEffectController } from "settings/effects/settingsSideEffectController";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import type { PluginSettings } from "settings/model";
import { getLazyLoadManager } from "obsidian-integration/observers/IntersectionObserverRegistry";
import {
	DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	DEFAULT_PREVIEW_IMAGE_DOM_COMMITS_PER_SECOND,
} from "card-preview/scheduling/previewSchedulingConfig";
import { setYieldSchedulingWindowResolver } from "indexing/timeSlicing";
import { createAllNotesCatalog } from "search/all-notes/allNotesCatalog";

export interface PluginRuntimeOptions {
	app: App;
	plugin: PluginHost;
	forceRedrawEffect: StateEffectType<undefined>;
	getSettings: () => PluginSettings;
	isUnloaded: () => boolean;
	bumpSortContextVersion: () => void;
	getSortContextVersion: () => number;
	updateSortOption: (option: SortOption) => void;
	updateContentSearch: (enabled: boolean) => void;
	updateSidebarView: (file: TFile) => void;
	destroySettings: () => void;
}

export interface PluginRuntime {
	frameScheduler: FrameScheduler;
	previewService: DisposablePreviewService;
	previewRuntime: PreviewRuntime;
	indexingService: IndexingService;
	twoHopLinkResolver: TwoHopLinkResolver;
	sortService: SortService;
	indexUpdateQueue: IndexUpdateQueue;
	displayModeController: DisplayModeController;
	canvasDropManager: CanvasDropManager;
	domMutationObserver: DOMMutationObserver;
	componentController: ComponentController;
	viewUpdateOrchestrator: ViewUpdateOrchestrator;
	renderedMdElementsRegistry: RenderedMdElementsRegistry;
	scrollManager: ScrollManager;
	emptyViewController: EmptyViewController;
	keyboardCardNavigator: KeyboardCardNavigator;
	applySettingsSideEffects: (changedKeys: Iterable<keyof PluginSettings>) => void;
	linkStatusService: LinkStatusService;
	stylingService: StylingService;
	propertyWidgetStyler: PropertyWidgetStyler;
	linkContextFactory: (file: TFile, settings: PluginSettings) => LinkContext;
	viewServices: ViewServices;
	destroy(): void;
}

/** Creates, connects, and owns the services used for one plugin load. */
export function createPluginRuntime(options: PluginRuntimeOptions): PluginRuntime {
	const resetYieldSchedulingWindowResolver = setYieldSchedulingWindowResolver(() =>
		resolveWorkspaceWindow(options.app.workspace),
	);
	const frameScheduler = createFrameScheduler(options.isUnloaded, () =>
		resolveWorkspaceWindow(options.app.workspace),
	);
	const previewService = createLazyPreviewService({
		vault: options.app.vault,
		metadataCache: options.app.metadataCache,
		app: options.app,
		getSettings: options.getSettings,
	});
	const previewRuntime = createLazyPreviewRuntime({
		app: options.app,
		getPreview: previewService.getPreview,
		getRawContent: previewService.getRawContent,
		getDomCommitsPerSecond: () => DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
		getImageDomCommitsPerSecond: () => DEFAULT_PREVIEW_IMAGE_DOM_COMMITS_PER_SECOND,
	});
	options.plugin.register(() => previewService.dispose());

	const indexingService = new IndexingService(
		options.app.vault,
		options.app.metadataCache,
		() => options.getSettings().enableTagFeatures,
	);
	const twoHopLinkResolver = new TwoHopLinkResolver(
		options.app.metadataCache,
		indexingService,
	);
	const metricProvider = new MetricProvider(
		options.app.metadataCache,
		options.app.vault,
		indexingService,
		() => {
			const settings = options.getSettings();
			return {
				frontmatterKeyCreatedDate: settings.frontmatterKeyCreatedDate,
				frontmatterKeyModifiedDate: settings.frontmatterKeyModifiedDate,
				priorityFrontmatterKeyForTitle: settings.priorityFrontmatterKeyForTitle,
			};
		},
	);
	const sortService = new SortService(metricProvider);
	const allNotesCatalog = createAllNotesCatalog({
		app: options.app,
		sortService,
		getSortContextVersion: options.getSortContextVersion,
	});
	const keyboardNavigationSurfaceRegistry = createKeyboardNavigationSurfaceRegistry();
	const linkStatusService = createLinkStatusService(
		indexingService,
		options.getSettings,
	);
	const stylingService = createStylingService(linkStatusService);
	const propertyWidgetStyler = createPropertyWidgetStyler(stylingService);
	const renderedMdElementsRegistry = new RenderedMdElementsRegistry(stylingService);
	const linkContextFactory = createLinkContextFactory(
		options.app.metadataCache,
		indexingService,
		options.app.vault,
		options.app.workspace,
		options.plugin,
		options.app,
		previewService,
	);
	const createPluginDisplayDataBuilder = () =>
		createDisplayDataBuilder({
			sortService,
			getLinkTargets: (path) =>
				getRelevanceLinkTargets(
					path,
					options.app.metadataCache,
					options.app.vault,
				),
			getSortContextVersion: options.getSortContextVersion,
		});
	const resolveTwoHopLinks: ResolveTwoHopLinks = (file, onProgress, signal) => {
		const settings = options.getSettings();
		return twoHopLinkResolver.resolveSnapshot(file, onProgress, {
			includeTaggedNotes: settings.enableTagFeatures && settings.showTagsSection,
			signal,
		});
	};
	const componentController = new ComponentController(
		options.app,
		options.plugin,
		options.getSettings,
		resolveTwoHopLinks,
		indexingService,
		options.updateSortOption,
		{
			createDisplayDataBuilder: createPluginDisplayDataBuilder,
			createLinkContext: linkContextFactory,
			previewRuntime,
			keyboardNavigationSurfaceRegistry,
		},
		options.updateContentSearch,
	);
	const viewServices: ViewServices = {
		createCardCollectionState: (settings) => {
			const { CardCollectionState } =
				require("cards/CardCollectionState.svelte") as typeof import("cards/CardCollectionState.svelte");
			return new CardCollectionState(
				settings,
				options.updateSortOption,
				options.updateContentSearch,
			);
		},
		createTwoHopState: (settings) =>
			componentController.createTwoHopState(
				settings,
				createPluginDisplayDataBuilder(),
				resolveTwoHopLinks,
			),
		createLinkContext: linkContextFactory,
		previewRuntime,
		allNotesCatalog,
		keyboardNavigationSurfaceRegistry,
	};
	const domMutationObserver = new DOMMutationObserver(options.plugin, stylingService);
	const indexUpdateQueue = new IndexUpdateQueue(options.plugin, indexingService);
	const displayModeController = new DisplayModeController(
		options.app,
		options.getSettings,
		componentController,
		options.plugin,
		options.updateSidebarView,
		() => options.app.workspace.getActiveFile(),
	);
	const canvasDropManager = new CanvasDropManager(options.app);
	canvasDropManager.registerCanvasDropHandler((eventRef) =>
		options.plugin.registerEvent(eventRef),
	);
	const viewUpdateOrchestrator = createViewUpdateOrchestrator({
		app: options.app,
		indexingService,
		forceRedrawEffect: options.forceRedrawEffect,
		stylingService,
		markdownRenderManager: renderedMdElementsRegistry,
		propertyStyleManager: propertyWidgetStyler,
	});
	const scrollManager = new ScrollManager();
	const emptyViewController = createEmptyViewController(options.app, options.plugin);
	const keyboardCardNavigator = new KeyboardCardNavigator(
		keyboardNavigationSurfaceRegistry,
		undefined,
		() => options.getSettings().language,
	);

	const unsubscribeIndexDataUpdate = indexingService.onDataUpdate((context) => {
		sortService.invalidateCache();
		options.bumpSortContextVersion();
		allNotesCatalog.invalidateSorting();
		viewUpdateOrchestrator.updateForContext(context);
	});

	const applySettingsSideEffects = createSettingsSideEffectController({
		viewUpdateOrchestrator,
		emptyViewController,
		displayModeManager: displayModeController,
		sortService,
		invalidateAllNotesSorting: () => allNotesCatalog.invalidateSorting(),
		indexingService,
		workspace: options.app.workspace,
		bumpSortContextVersion: options.bumpSortContextVersion,
	});

	function destroy(): void {
		resetYieldSchedulingWindowResolver();
		frameScheduler.destroy();
		options.destroySettings();
		unsubscribeIndexDataUpdate();
		indexUpdateQueue.destroy();
		previewRuntime.dispose();
		allNotesCatalog.destroy();
		componentController.destroy();
		twoHopLinkResolver.destroy();
		displayModeController.destroy();
		canvasDropManager.destroy();
		domMutationObserver.destroy();
		emptyViewController.destroy();
		keyboardCardNavigator.deactivate();
		keyboardNavigationSurfaceRegistry.clear();
		renderedMdElementsRegistry.destroy();
		getLazyLoadManager().cleanup();
	}

	return {
		frameScheduler,
		previewService,
		previewRuntime,
		indexingService,
		twoHopLinkResolver,
		sortService,
		indexUpdateQueue,
		displayModeController,
		canvasDropManager,
		domMutationObserver,
		componentController,
		viewUpdateOrchestrator,
		renderedMdElementsRegistry,
		scrollManager,
		emptyViewController,
		keyboardCardNavigator,
		applySettingsSideEffects,
		linkStatusService,
		stylingService,
		propertyWidgetStyler,
		linkContextFactory,
		viewServices,
		destroy,
	};
}
