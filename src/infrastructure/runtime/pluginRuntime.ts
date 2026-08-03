import type { App, TFile } from "obsidian";
import { createEventHandlers } from "infrastructure/workspace/eventHandlers";
import { createWorkspaceViewQueries } from "infrastructure/workspace/workspaceViewQueries";
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
import {
	createEmptyViewController,
	type EmptyViewController,
} from "infrastructure/lifecycle/emptyViewController";
import { IndexingService } from "core/indexing/index-service/IndexingService";
import { TwoHopLinkResolver } from "features/two-hop/domain/TwoHopLinkResolver";
import { createLinkContextFactory } from "ui/context/linkContextFactory";
import type { LinkContext } from "ui/context/linkContext";
import { SortService } from "core/sorting/SortService";
import { MetricProvider } from "core/sorting/MetricProvider";
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
} from "features/preview/core/createPreviewService";
import {
	createPreviewRuntime,
	type PreviewRuntime,
} from "features/preview/runtime/previewRuntime";
import {
	createSettingsSideEffectController,
	type SettingsSideEffectController,
} from "features/settings/effects/settingsSideEffectController";
import type { SettingsManager } from "features/settings/persistence/SettingsManager";
import type { PluginHostUi } from "types/pluginHostUi";
import {
	areTagFeaturesEnabled,
	type PluginSettings,
	type SortOption,
} from "features/settings/model";
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
import { resolvePreviewActivationsPerSecond } from "appConstants";

export interface PluginRuntimeOptions {
	app: App;
	plugin: PluginHostUi;
	settingsManager: SettingsManager;
	getSettings: () => PluginSettings;
	getSettingsSnapshot: () => PluginSettings;
	isUnloaded: () => boolean;
	bumpSortContextVersion: () => void;
	updateSortOption: (option: SortOption) => void;
	updateContentSearch: (enabled: boolean) => void;
	updateSidebarView: (file: TFile) => void;
	setLoggingEnabled: (enabled: boolean) => void;
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
	destroy(): void;
}

/** Creates, connects, and owns the services used for one plugin load. */
export function createPluginRuntime(options: PluginRuntimeOptions): PluginRuntime {
	const frameScheduler = createFrameScheduler(options.isUnloaded);
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
		getActivationsPerSecond: () =>
			resolvePreviewActivationsPerSecond(
				options.getSettings().previewDomCommitsPerSecond,
			),
		getDomCommitsPerSecond: () => options.getSettings().previewDomCommitsPerSecond,
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
		() => ({
			enableProgressiveTwoHopBuild:
				options.getSettings().enableProgressiveTwoHopBuild,
			maxOutgoingToProcess: options.getSettings().maxOutgoingToProcess,
			maxHop2PerBranch: options.getSettings().maxHop2PerBranch,
		}),
	);
	const metricProvider = new MetricProvider(
		options.app.metadataCache,
		options.app.vault,
		indexingService,
		options.getSettings,
	);
	const sortService = new SortService(metricProvider);
	const eventHandlers = createEventHandlers(
		options.app.metadataCache,
		options.app.vault,
		options.app.workspace,
	);
	const linkStatusService = createLinkStatusService(
		indexingService,
		options.getSettings,
	);
	const stylingService = createStylingService(linkStatusService);
	const propertyWidgetStyler = createPropertyWidgetStyler(stylingService);
	const renderedMdElementsRegistry = new RenderedMdElementsRegistry(stylingService);
	const workspaceViewQueries = createWorkspaceViewQueries(options.app.workspace);
	const linkContextFactory = createLinkContextFactory(
		options.app.metadataCache,
		eventHandlers,
		indexingService,
		options.app.vault,
		options.app.workspace,
		options.plugin,
		options.app,
		previewService,
	);
	const componentController = new ComponentController(
		options.app,
		options.plugin,
		options.getSettingsSnapshot,
		indexingService,
		options.updateSortOption,
		options.updateContentSearch,
	);
	const domMutationObserver = new DOMMutationObserver(options.plugin, stylingService);
	const indexUpdateQueue = new IndexUpdateQueue(options.plugin, indexingService);
	const displayModeController = new DisplayModeController(
		options.app,
		options.settingsManager,
		workspaceViewQueries,
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
		plugin: options.plugin,
		stylingService,
		markdownRenderManager: renderedMdElementsRegistry,
		propertyStyleManager: propertyWidgetStyler,
	});
	const scrollManager = new ScrollManager();
	const emptyViewController = createEmptyViewController(options.app, options.plugin);
	const keyboardCardNavigator = new KeyboardCardNavigator(options.app);

	indexUpdateQueue.onDataUpdate((context) => {
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
		getSettings: options.getSettings,
		bumpSortContextVersion: options.bumpSortContextVersion,
		setLoggingEnabled: options.setLoggingEnabled,
	});

	function destroy(): void {
		frameScheduler.destroy();
		options.destroySettings();
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
		destroy,
	};
}
