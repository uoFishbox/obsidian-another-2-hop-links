import { Plugin, TFile, loadMathJax } from "obsidian";
import { installMathJaxShadowPatch } from "ui/utils/mathJaxShadowStyles";
import { SettingsManager } from "settings/SettingsManager";
import { CosenseCardLinksSettingTab } from "settings/SettingTab";
import {
	createSettingsSideEffectController,
	type SettingsSideEffectController,
} from "settings/settingsSideEffectController";
import { areTagFeaturesEnabled, DEFAULT_SETTINGS } from "types/settings";
import { TwoHopLinksView, TWO_HOP_LINKS_VIEW_TYPE } from "ui/views/TwoHopLinksView";
import type { ResolveProgress, TwoHopLinkResult } from "types/domain";
import type { PluginSettings, SortOption } from "types/settings";
import { forceRedrawEffect } from "infrastructure/markdown/livePreview";
import {
	createWorkspaceViewQueries,
	type WorkspaceViewQueries,
} from "infrastructure/workspace/workspaceViewQueries";
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
import { createEventHandlers } from "infrastructure/workspace/eventHandlers";
import { IndexingService } from "core/indexing/index-service/IndexingService";
import {
	TwoHopLinkResolver,
	type ResolveOptions,
} from "core/indexing/two-hop-resolver/TwoHopLinkResolver";
import { createLinkContextFactory } from "ui/context/linkContextFactory";
import type { LinkContext } from "ui/context/linkContext";
import { SortService } from "core/sorting/SortService";
import { MetricProvider } from "core/sorting/MetricProvider";
import {
	createDisplayDataBuilder,
	type DisplayDataBuilder,
} from "application/presenters/displayDataBuilder";
import { createDeduplicationService } from "core/deduplication/deduplicationService";
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
import { getLazyLoadManager } from "infrastructure/observers/IntersectionObserverRegistry";
import { logger, setEnableLogging } from "utils/logger";
import { KeyboardCardNavigator } from "features/keyboard-navigation/KeyboardCardNavigator";
import type { ResolveTwoHopLinks } from "ui/stores/application/TwoHopLinksLoader";
import {
	createPreviewService,
	type DisposablePreviewService,
} from "features/preview/core/createPreviewService";
import { clearCardPreviewSharedCaches } from "ui/components/common/cardPreviewSharedCache";
import { installCCLDebugExposure } from "infrastructure/debug/CCLDebugExposure";
import { registerBenchmarkCommand } from "infrastructure/debug/benchmarkCommandController";
import { registerCardDragStateCleanup } from "ui/interactions/cardDragState";
import { registerViews } from "infrastructure/registration/registerViews";
import { registerCommands } from "infrastructure/registration/registerCommands";
import { registerEditorExtensions } from "infrastructure/registration/registerEditorExtensions";
import { registerMarkdownProcessors } from "infrastructure/registration/registerMarkdownProcessors";
import { registerFileMenu } from "infrastructure/registration/registerFileMenu";
import { installAllPatchers } from "infrastructure/patchers/installAllPatchers";
import { setupWorkspaceEventHandlers } from "infrastructure/workspace/workspaceEventBootstrap";
import { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";
import type { PluginHost } from "types/pluginHost";

export default class CosenseCardLinksPlugin extends Plugin implements PluginHost {
	public settings: PluginSettings = { ...DEFAULT_SETTINGS };
	public settingsManager!: SettingsManager;
	private readonly patchRegistry = new PatchRegistry();

	// Core services
	public indexingService!: IndexingService;
	private twoHopLinkResolver!: TwoHopLinkResolver;
	public sortService!: SortService;
	private previewService!: DisposablePreviewService;

	// Managers
	private workspaceViewQueries!: WorkspaceViewQueries;
	public indexUpdateQueue!: IndexUpdateQueue;
	private displayModeManager!: DisplayModeController;
	private canvasDropManager!: CanvasDropManager;
	private domMutationObserver!: DOMMutationObserver;
	public componentController!: ComponentController;
	private viewUpdateOrchestrator!: ViewUpdateOrchestrator;
	private renderedMdElementsRegistry!: RenderedMdElementsRegistry;
	private scrollManager!: ScrollManager;
	private emptyViewController!: EmptyViewController;
	private keyboardCardNavigator!: KeyboardCardNavigator;
	private frameScheduler!: FrameScheduler;
	private sideEffectController!: SettingsSideEffectController;

	// UI services
	private linkStatusService!: LinkStatusService;
	private stylingService!: StylingService;
	private propertyWidgetStyler!: PropertyWidgetStyler;
	private linkContextFactory!: (
		file: TFile,
		settings: PluginSettings,
	) => LinkContext;

	public readonly forceRedrawEffect = forceRedrawEffect;
	private sortContextVersion = 0;
	private isUnloaded = false;

	async onload(): Promise<void> {
		this.isUnloaded = false;
		this.settingsManager = new SettingsManager(this);

		try {
			await this.settingsManager.load();
		} catch (error) {
			console.error(
				"設定の初期化に失敗しました。デフォルト設定を使用します。",
			);
		}

		setEnableLogging(this.settings.enableLogging);

		this.initializeServices();
		registerCardDragStateCleanup(this);
		installCCLDebugExposure(this);

		this.addSettingTab(new CosenseCardLinksSettingTab(this.app, this));
		registerViews(this);
		registerCommands(this, {
			scrollManager: this.scrollManager,
			keyboardCardNavigator: this.keyboardCardNavigator,
		});
		registerBenchmarkCommand(this, this.indexingService);
		registerEditorExtensions(this, {
			linkStatusService: this.linkStatusService,
		});
		registerMarkdownProcessors(this, {
			app: this.app,
			indexingService: this.indexingService,
			stylingService: this.stylingService,
			renderedMdElementsRegistry: this.renderedMdElementsRegistry,
		});
		registerFileMenu(this, {
			app: this.app,
			getTwoHopLinkResult: (file, onProgress, options) =>
				this.getTwoHopLinkResult(file, onProgress, options),
		});

		this.app.workspace.onLayoutReady(async () => {
			if (this.isUnloaded) {
				return;
			}

			installAllPatchers(this, this.patchRegistry, {
				stylingService: this.stylingService,
				propertyWidgetStyler: this.propertyWidgetStyler,
			});

			await loadMathJax();
			if (this.isUnloaded) {
				return;
			}
			installMathJaxShadowPatch();

			this.displayModeManager.handleSettingsChange();

			this.domMutationObserver.initialize();
			this.emptyViewController.sync();
			setupWorkspaceEventHandlers(this, {
				workspace: this.app.workspace,
				frameScheduler: this.frameScheduler,
				domMutationObserver: this.domMutationObserver,
				emptyViewController: this.emptyViewController,
				propertyWidgetStyler: this.propertyWidgetStyler,
				displayModeManager: this.displayModeManager,
				viewUpdateOrchestrator: this.viewUpdateOrchestrator,
				scrollManager: this.scrollManager,
				isUnloaded: () => this.isUnloaded,
			});

			// 起動時のpropertyスキャン
			// インデックスを待ってから実行
			await this.indexingService.awaitIdle();
			if (this.isUnloaded) {
				return;
			}
			this.propertyWidgetStyler.scanAndRegisterAll(this.app);
		});
	}

	// DisplayDataBuilder factory
	public createDisplayDataBuilder(): DisplayDataBuilder {
		return createDisplayDataBuilder({
			sortService: this.sortService,
			createDeduplicationService: (settings: PluginSettings) => {
				const dedupeEnabled = settings?.dedupeCards ?? true;
				return dedupeEnabled
					? createDeduplicationService()
					: undefined;
			},
			getSortContextVersion: () => this.getSortContextVersion(),
		});
	}

	private bumpSortContextVersion(): void {
		this.sortContextVersion += 1;
	}

	public getSortContextVersion(): number {
		return this.sortContextVersion;
	}

	private updateSidebarView(file: TFile): void {
		const leaves = this.app.workspace.getLeavesOfType(
			TWO_HOP_LINKS_VIEW_TYPE,
		);
		leaves.forEach((leaf) => {
			if (leaf.view instanceof TwoHopLinksView) {
				leaf.view.renderForFile(file);
			}
		});
	}

	onunload(): void {
		this.isUnloaded = true;
		if (this.frameScheduler) {
			this.frameScheduler.destroy();
		}
		void this.settingsManager?.destroy().catch((error) => {
			console.error("設定の保存に失敗しました:", error);
		});
		if (this.indexUpdateQueue) {
			this.indexUpdateQueue.destroy();
		}
		clearCardPreviewSharedCaches();
		if (this.componentController) {
			this.componentController.destroy();
		}

		if (this.twoHopLinkResolver) {
			this.twoHopLinkResolver.destroy();
		}

		if (this.displayModeManager) {
			this.displayModeManager.destroy();
		}

		if (this.canvasDropManager) {
			this.canvasDropManager.destroy();
		}

		if (this.domMutationObserver) {
			this.domMutationObserver.destroy();
		}

		if (this.emptyViewController) {
			this.emptyViewController.destroy();
		}

		if (this.keyboardCardNavigator) {
			this.keyboardCardNavigator.deactivate();
		}

		if (this.renderedMdElementsRegistry) {
			this.renderedMdElementsRegistry.destroy();
		}

		getLazyLoadManager().cleanup();
	}

	private initializeServices(): void {
		this.frameScheduler = createFrameScheduler(() => this.isUnloaded);
		this.previewService = createPreviewService({
			vault: this.app.vault,
			metadataCache: this.app.metadataCache,
			app: this.app,
			getSettings: () => this.settings,
		});
		this.register(() => this.previewService.dispose());

		this.indexingService = new IndexingService(
			this.app.vault,
			this.app.metadataCache,
			() => areTagFeaturesEnabled(this.settings),
		);

		this.twoHopLinkResolver = new TwoHopLinkResolver(
			this.app.metadataCache,
			this.app.vault,
			this.indexingService,
			() => ({
				enableProgressiveTwoHopBuild:
					this.settings.enableProgressiveTwoHopBuild,
				maxOutgoingToProcess: this.settings.maxOutgoingToProcess,
				maxHop2PerBranch: this.settings.maxHop2PerBranch,
			}),
		);

		const metricProvider = new MetricProvider(
			this.app.metadataCache,
			this.app.vault,
			this.indexingService,
			() => this.settings,
		);

		this.sortService = new SortService(metricProvider);

		const eventHandlers = createEventHandlers(
			this.app.metadataCache,
			this.app.vault,
			this.app.workspace,
		);

		// 2. UIサービスとファクトリをインスタンス化
		// LinkStatusService を先に初期化（純粋な判定ロジックを提供）
		this.linkStatusService = createLinkStatusService(
			this.indexingService,
			() => this.settings,
		);

		// StylingService は LinkStatusService に依存
		this.stylingService = createStylingService(this.linkStatusService);

		// PropertyWidgetStylerをStylingServiceの直後に初期化
		this.propertyWidgetStyler = createPropertyWidgetStyler(
			this.stylingService,
		);

		this.renderedMdElementsRegistry = new RenderedMdElementsRegistry(
			this.stylingService,
		);

		this.workspaceViewQueries = createWorkspaceViewQueries(
			this.app.workspace,
		);

		this.linkContextFactory = createLinkContextFactory(
			this.app.metadataCache,
			eventHandlers,
			this.indexingService,
			this.app.vault,
			this.app.workspace,
			this,
			this.app,
			this.previewService,
		);

		// 3. マネージャ層をインスタンス化（直接依存を注入）
		this.componentController = new ComponentController(
			this.app,
			this,
			() => this.settingsManager.getSnapshot(),
			this.indexingService,
			(option: SortOption) => {
				void this.updateSetting("lastUsedSortOption", option).catch(
					(error) => {
						console.error("設定の更新に失敗しました:", error);
					},
				);
			},
			(enabled: boolean) => {
				void this.updateSetting("enableContentSearch", enabled).catch(
					(error) => {
						console.error("設定の更新に失敗しました:", error);
					},
				);
			},
		);

		this.domMutationObserver = new DOMMutationObserver(
			this,
			this.stylingService,
		);

		this.indexUpdateQueue = new IndexUpdateQueue(
			this,
			this.indexingService,
		);

		this.displayModeManager = new DisplayModeController(
			this.app,
			this.settingsManager,
			this.workspaceViewQueries,
			this.componentController,
			this,
			(file: TFile) => this.updateSidebarView(file),
			() => this.app.workspace.getActiveFile(),
		);

		this.canvasDropManager = new CanvasDropManager(this.app);
		this.canvasDropManager.registerCanvasDropHandler((eventRef) =>
			this.registerEvent(eventRef),
		);

		this.viewUpdateOrchestrator = createViewUpdateOrchestrator({
			app: this.app,
			plugin: this,
			stylingService: this.stylingService,
			markdownRenderManager: this.renderedMdElementsRegistry,
			propertyStyleManager: this.propertyWidgetStyler,
		});

		this.scrollManager = new ScrollManager();
		this.emptyViewController = createEmptyViewController(this.app, this);
		this.keyboardCardNavigator = new KeyboardCardNavigator(this.app);

		// IndexingService の通知は indexUpdateQueue 経由で集約する。
		this.indexUpdateQueue.onDataUpdate((context) => {
			this.sortService.invalidateCache();
			this.bumpSortContextVersion();
			this.viewUpdateOrchestrator.updateForContext(context);
		});

		this.indexUpdateQueue.setupEventListeners();

		this.sideEffectController = createSettingsSideEffectController({
			viewUpdateOrchestrator: this.viewUpdateOrchestrator,
			emptyViewController: this.emptyViewController,
			displayModeManager: this.displayModeManager,
			sortService: this.sortService,
			indexingService: this.indexingService,
			workspace: this.app.workspace,
			getSettings: () => this.settings,
			bumpSortContextVersion: () => this.bumpSortContextVersion(),
			setLoggingEnabled: (enabled) => {
				setEnableLogging(enabled);
			},
		});
	}

	public async updateSetting<K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
		options: { immediate?: boolean } = {},
	): Promise<void> {
		const updatePromise = this.settingsManager.update(key, value, options);
		this.sideEffectController.apply(
			[key],
			this.settingsManager.getSnapshot(),
		);
		await updatePromise;
	}

	public async updateSettings(
		updates: Partial<PluginSettings>,
		options: { immediate?: boolean } = {},
	): Promise<void> {
		const updatePromise = this.settingsManager.updateBatch(
			updates,
			options,
		);
		this.sideEffectController.apply(
			Object.keys(updates) as Array<keyof PluginSettings>,
			this.settingsManager.getSnapshot(),
		);
		await updatePromise;
	}

	public async getTwoHopLinkResult(
		file: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopLinkResult> {
		return this.twoHopLinkResolver.resolve(file, onProgress, options);
	}

	public processUnresolvedLinksInElement(
		el: HTMLElement,
		sourcePath: string,
	): void {
		this.stylingService.decorateLinksInContainer(el, sourcePath);
	}

	public getLinkContextFactory() {
		return this.linkContextFactory;
	}

	public createApplicationStore(
		settings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	) {
		return this.componentController.createApplicationStore(
			settings,
			displayDataBuilder,
			resolveTwoHopLinks,
		);
	}

	public getOrCreateApplicationStore(
		leafId: string,
		filePath: string,
		settings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	) {
		return this.componentController.getOrCreateApplicationStore(
			leafId,
			filePath,
			settings,
			displayDataBuilder,
			resolveTwoHopLinks,
		);
	}

	public clearStore(leafId: string, filePath: string): void {
		this.componentController.clearStore(leafId, filePath);
	}
}
