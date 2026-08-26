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
import { createLinkContextFactory } from "cards/context/linkContextFactory";
import type { LinkContext } from "cards/context/linkContext";
import { CardCollectionState } from "cards/CardCollectionState.svelte";
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
import {
	createPreviewService,
	type DisposablePreviewService,
} from "preview/pipeline/createPreviewService";
import {
	createPreviewRuntime,
	type PreviewRuntime,
} from "preview/runtime/previewRuntime";
import {
	createSettingsSideEffectController,
	type SettingsSideEffectController,
} from "settings/effects/settingsSideEffectController";
import type { SettingsManager } from "settings/persistence/SettingsManager";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import { areTagFeaturesEnabled, type PluginSettings } from "settings/model";
import { getLazyLoadManager } from "obsidian-integration/observers/IntersectionObserverRegistry";
import { DEFAULT_PREVIEW_DOM_COMMITS_PER_SECOND } from "preview/scheduling/previewSchedulingConfig";
import { setYieldSchedulingWindowResolver } from "indexing/timeSlicing";
import { createAllNotesCatalog } from "search/all-notes/allNotesCatalog";

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
	const allNotesCatalog = createAllNotesCatalog({
		app: options.app,
		sortService,
		getSortContextVersion: options.getSortContextVersion,
	});
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
		createCardCollectionState: (settings) =>
			new CardCollectionState(
				settings,
				options.updateSortOption,
				options.updateContentSearch,
			),
		createTwoHopState: (settings) =>
			componentController.createTwoHopState(
				settings,
				createPluginDisplayDataBuilder(),
				resolveTwoHopLinks,
			),
		createLinkContext: linkContextFactory,
		previewRuntime,
		allNotesCatalog,
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
		allNotesCatalog.invalidateSorting();
		viewUpdateOrchestrator.updateForContext(context);
	});
	indexUpdateQueue.setupEventListeners();

	const sideEffectController = createSettingsSideEffectController({
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
