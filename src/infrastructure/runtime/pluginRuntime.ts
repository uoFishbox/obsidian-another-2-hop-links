import type { App, TFile } from "obsidian";
import type { StateEffectType } from "@codemirror/state";
import { IndexUpdateQueue } from "infrastructure/lifecycle/IndexUpdateQueue";
import { ComponentController } from "infrastructure/lifecycle/ComponentController";
import {
	createViewUpdateOrchestrator,
	type ViewUpdateOrchestrator,
} from "infrastructure/lifecycle/viewUpdateOrchestrator";
import {
	createFrameScheduler,
	type FrameScheduler,
} from "infrastructure/lifecycle/frameScheduler";
import { RenderedMdElementsRegistry } from "infrastructure/markdown/RenderedMdElementsRegistry";
import { DisplayModeController } from "features/display-mode/DisplayModeController";
import { CanvasDropManager } from "infrastructure/workspace/CanvasDropHandler";
import { DOMMutationObserver } from "infrastructure/observers/DOMMutationObserver";
import { ScrollManager } from "infrastructure/workspace/ScrollHistoryState";
import { resolveWorkspaceWindow } from "infrastructure/workspace/workspaceDocuments";
import {
	createEmptyViewController,
	type EmptyViewController,
} from "infrastructure/lifecycle/emptyViewController";
import { IndexingService } from "core/indexing/index-service/IndexingService";
import { TwoHopLinkResolver } from "features/two-hop/domain/TwoHopLinkResolver";
import type { ResolveTwoHopLinks } from "features/two-hop/application/TwoHopLinksLoader";
import { createDisplayDataBuilder } from "features/two-hop/application/displayDataBuilder";
import { createLinkContextFactory } from "ui/context/linkContextFactory";
import type { LinkContext } from "ui/context/linkContext";
import { SortService } from "core/sorting/SortService";
import { MetricProvider } from "core/sorting/MetricProvider";
import type { SortOption } from "core/sorting";
import {
	createStylingService,
	type StylingService,
} from "features/link-decoration/stylingService";
import {
	createLinkStatusService,
	type LinkStatusService,
} from "features/link-decoration/linkStatusService";
import {
	createPropertyWidgetStyler,
	type PropertyWidgetStyler,
} from "features/link-decoration/propertyWidgetStyler";
import { KeyboardCardNavigator } from "features/keyboard-navigation/KeyboardCardNavigator";
import {
	createPreviewService,
	type DisposablePreviewService,
} from "features/card-preview/core/createPreviewService";
import {
	createPreviewRuntime,
	type PreviewRuntime,
} from "features/card-preview/runtime/previewRuntime";
import {
	createSettingsSideEffectController,
	type SettingsSideEffectController,
} from "features/settings/effects/settingsSideEffectController";
import type { SettingsManager } from "features/settings/persistence/SettingsManager";
import type { PluginHost } from "types/pluginHost";
import type { ViewServices } from "ui/shared/views/viewServices";
import { areTagFeaturesEnabled, type PluginSettings } from "features/settings/model";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
import {
	DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
	DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
} from "appConstants";
import { setYieldSchedulingWindowResolver } from "core/indexing/timeSlicing";

export interface PluginRuntimeOptions {
	app: App;
	plugin: PluginHost;
	forceRedrawEffect: StateEffectType<undefined>;
	settingsManager: SettingsManager;
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
	sideEffectController: SettingsSideEffectController;
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
	const previewService = createPreviewService({
		vault: options.app.vault,
		metadataCache: options.app.metadataCache,
		app: options.app,
		getSettings: options.getSettings,
	});
	const previewRuntime = createPreviewRuntime({
		app: options.app,
		getPreview: previewService.getPreview,
		getOutstandingPreviewJobCount: () =>
			previewService.getOutstandingVisiblePreviewCount(),
		subscribeBackpressure: (listener) =>
			previewService.subscribeVisiblePreviewQueue(() => {
				listener();
			}),
		getActivationsPerSecond: () => DEFAULT_PREVIEW_ACTIVATIONS_PER_SECOND,
		getDomCommitsPerSecond: () => DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND,
	});
	options.plugin.register(() => previewService.dispose());

	const indexingService = new IndexingService(
		options.app.vault,
		options.app.metadataCache,
		() => areTagFeaturesEnabled(options.getSettings()),
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
			getSortContextVersion: options.getSortContextVersion,
		});
	const resolveTwoHopLinks: ResolveTwoHopLinks = (file, onProgress, signal) => {
		const settings = options.getSettings();
		return twoHopLinkResolver.resolveSnapshot(file, onProgress, {
			includeTaggedNotes:
				areTagFeaturesEnabled(settings) && settings.showTagsSection,
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
		},
		options.updateContentSearch,
	);
	const viewServices: ViewServices = {
		createApplicationStore: (settings) =>
			componentController.createApplicationStore(
				settings,
				createPluginDisplayDataBuilder(),
				resolveTwoHopLinks,
			),
		createLinkContext: linkContextFactory,
		previewRuntime,
	};
	const domMutationObserver = new DOMMutationObserver(options.plugin, stylingService);
	const indexUpdateQueue = new IndexUpdateQueue(options.plugin, indexingService);
	const displayModeController = new DisplayModeController(
		options.app,
		options.settingsManager,
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
	const keyboardCardNavigator = new KeyboardCardNavigator(options.app);

	const unsubscribeIndexDataUpdate = indexingService.onDataUpdate((context) => {
		sortService.invalidateCache();
		options.bumpSortContextVersion();
		viewUpdateOrchestrator.updateForContext(context);
	});
	indexUpdateQueue.setupEventListeners();

	const sideEffectController = createSettingsSideEffectController({
		viewUpdateOrchestrator,
		emptyViewController,
		displayModeManager: displayModeController,
		sortService,
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
		componentController.destroy();
		twoHopLinkResolver.destroy();
		displayModeController.destroy();
		canvasDropManager.destroy();
		domMutationObserver.destroy();
		emptyViewController.destroy();
		keyboardCardNavigator.deactivate();
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
		sideEffectController,
		linkStatusService,
		stylingService,
		propertyWidgetStyler,
		linkContextFactory,
		viewServices,
		destroy,
	};
}
