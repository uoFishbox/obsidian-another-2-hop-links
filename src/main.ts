import { Plugin, TFile, loadMathJax } from "obsidian";
import { installMathJaxShadowPatch } from "ui/shared/dom/mathJaxShadowStyles";
import { SettingsManager } from "features/settings/persistence/SettingsManager";
import { CosenseCardLinksSettingTab } from "features/settings/ui/SettingTab";
import { DEFAULT_SETTINGS } from "features/settings/model";
import type { PluginSettings } from "features/settings/model";
import type { SortOption } from "core/sorting";
import {
	TwoHopLinksView,
	TWO_HOP_LINKS_VIEW_TYPE,
} from "features/two-hop/ui/TwoHopLinksView";
import type { ResolveProgress, TwoHopLinkResult } from "types/domain";
import type { ResolveOptions } from "features/two-hop/domain/TwoHopLinkResolver";
import type { TwoHopResolveSnapshot } from "features/two-hop/domain/ResolverDependencies";
import { forceRedrawEffect } from "infrastructure/markdown/livePreview";
import { setEnableLogging } from "shared/logging/logger";
import { installCCLDebugExposure } from "infrastructure/debug/CCLDebugExposure";
import { registerBenchmarkCommand } from "infrastructure/debug/benchmarkCommandController";
import { registerScrollBenchmarkCommand } from "infrastructure/debug/scrollBenchmarkCommandController";
import { registerCardDragStateCleanup } from "ui/interactions/cardDragState";
import { registerViews } from "infrastructure/registration/registerViews";
import { registerCommands } from "infrastructure/registration/registerCommands";
import { registerEditorExtensions } from "infrastructure/registration/registerEditorExtensions";
import { registerMarkdownProcessors } from "infrastructure/registration/registerMarkdownProcessors";
import { registerFileMenu } from "infrastructure/registration/registerFileMenu";
import { installAllPatchers } from "infrastructure/patchers/installAllPatchers";
import { setupWorkspaceEventHandlers } from "infrastructure/workspace/workspaceEventBootstrap";
import {
	createPluginRuntime,
	type PluginRuntime,
} from "infrastructure/runtime/pluginRuntime";
import type { PluginHost } from "types/pluginHost";

export default class CosenseCardLinksPlugin extends Plugin implements PluginHost {
	public settings: PluginSettings = { ...DEFAULT_SETTINGS };
	public settingsManager!: SettingsManager;
	private runtime!: PluginRuntime;

	private readonly forceRedrawEffect = forceRedrawEffect;
	private sortContextVersion = 0;
	private isUnloaded = false;

	public get indexingService(): PluginRuntime["indexingService"] {
		return this.runtime.indexingService;
	}

	public get sortService(): PluginRuntime["sortService"] {
		return this.runtime.sortService;
	}

	public get indexUpdateQueue(): PluginRuntime["indexUpdateQueue"] {
		return this.runtime.indexUpdateQueue;
	}

	public get componentController(): PluginRuntime["componentController"] {
		return this.runtime.componentController;
	}

	async onload(): Promise<void> {
		this.isUnloaded = false;
		this.settingsManager = new SettingsManager(this);

		try {
			await this.settingsManager.load();
		} catch (error) {
			console.error("設定の初期化に失敗しました。デフォルト設定を使用します。");
		}

		setEnableLogging(this.settings.enableLogging);
		this.runtime = this.createRuntime();
		this.registerPluginSurfaces();
		this.startWorkspaceRuntime();
	}

	private createRuntime(): PluginRuntime {
		return createPluginRuntime({
			app: this.app,
			plugin: this,
			forceRedrawEffect: this.forceRedrawEffect,
			settingsManager: this.settingsManager,
			getSettings: () => this.settings,
			isUnloaded: () => this.isUnloaded,
			bumpSortContextVersion: () => this.bumpSortContextVersion(),
			getSortContextVersion: () => this.getSortContextVersion(),
			updateSortOption: (option: SortOption) => {
				void this.updateSetting("lastUsedSortOption", option).catch((error) => {
					console.error("設定の更新に失敗しました:", error);
				});
			},
			updateContentSearch: (enabled: boolean) => {
				void this.updateSetting("enableContentSearch", enabled).catch(
					(error) => {
						console.error("設定の更新に失敗しました:", error);
					},
				);
			},
			updateSidebarView: (file) => this.updateSidebarView(file),
			setLoggingEnabled: setEnableLogging,
			destroySettings: () => {
				void this.settingsManager.destroy().catch((error) => {
					console.error("設定の保存に失敗しました:", error);
				});
			},
		});
	}

	private registerPluginSurfaces(): void {
		const runtime = this.runtime;
		registerCardDragStateCleanup(this);
		if (process.env.NODE_ENV !== "production") {
			installCCLDebugExposure(this);
		}

		this.addSettingTab(new CosenseCardLinksSettingTab(this.app, this));
		registerViews(this, runtime.viewServices);
		registerCommands(this, {
			scrollManager: runtime.scrollManager,
			keyboardCardNavigator: runtime.keyboardCardNavigator,
		});
		if (process.env.NODE_ENV !== "production") {
			registerBenchmarkCommand(this, runtime.indexingService);
			registerScrollBenchmarkCommand(this);
		}
		registerEditorExtensions(this, {
			linkStatusService: runtime.linkStatusService,
		});
		registerMarkdownProcessors(this, {
			app: this.app,
			indexingService: runtime.indexingService,
			stylingService: runtime.stylingService,
			renderedMdElementsRegistry: runtime.renderedMdElementsRegistry,
		});
		registerFileMenu(this, {
			app: this.app,
			getTwoHopLinkResult: (file, onProgress, options) =>
				this.getTwoHopLinkResult(file, onProgress, options),
		});
	}

	private startWorkspaceRuntime(): void {
		const runtime = this.runtime;
		this.app.workspace.onLayoutReady(async () => {
			if (this.isUnloaded) return;

			installAllPatchers(this, {
				propertyWidgetStyler: runtime.propertyWidgetStyler,
			});

			await loadMathJax();
			if (this.isUnloaded) return;
			installMathJaxShadowPatch();

			runtime.displayModeController.handleSettingsChange();
			runtime.domMutationObserver.initialize();
			runtime.emptyViewController.sync();
			setupWorkspaceEventHandlers(this, {
				workspace: this.app.workspace,
				frameScheduler: runtime.frameScheduler,
				domMutationObserver: runtime.domMutationObserver,
				emptyViewController: runtime.emptyViewController,
				propertyWidgetStyler: runtime.propertyWidgetStyler,
				displayModeManager: runtime.displayModeController,
				viewUpdateOrchestrator: runtime.viewUpdateOrchestrator,
				scrollManager: runtime.scrollManager,
				isUnloaded: () => this.isUnloaded,
			});

			await runtime.indexingService.awaitIdle();
			if (this.isUnloaded) return;
			runtime.propertyWidgetStyler.scanAndRegisterAll(this.app);
		});
	}

	onunload(): void {
		this.isUnloaded = true;
		this.runtime?.destroy();
	}

	private bumpSortContextVersion(): void {
		this.sortContextVersion += 1;
	}

	private getSortContextVersion(): number {
		return this.sortContextVersion;
	}

	private updateSidebarView(file: TFile): void {
		const leaves = this.app.workspace.getLeavesOfType(TWO_HOP_LINKS_VIEW_TYPE);
		leaves.forEach((leaf) => {
			if (leaf.view instanceof TwoHopLinksView) {
				leaf.view.renderForFile(file);
			}
		});
	}

	public async updateSetting<K extends keyof PluginSettings>(
		key: K,
		value: PluginSettings[K],
		options: { immediate?: boolean } = {},
	): Promise<void> {
		const updatePromise = this.settingsManager.update(key, value, options);
		this.runtime.sideEffectController.apply([key], this.settings);
		await updatePromise;
	}

	public async updateSettings(
		updates: Partial<PluginSettings>,
		options: { immediate?: boolean } = {},
	): Promise<void> {
		const updatePromise = this.settingsManager.updateBatch(updates, options);
		this.runtime.sideEffectController.apply(
			Object.keys(updates) as Array<keyof PluginSettings>,
			this.settings,
		);
		await updatePromise;
	}

	public async getTwoHopLinkResult(
		file: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopLinkResult> {
		return this.runtime.twoHopLinkResolver.resolve(file, onProgress, options);
	}

	public async getTwoHopResolveSnapshot(
		file: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopResolveSnapshot> {
		return this.runtime.twoHopLinkResolver.resolveSnapshot(
			file,
			onProgress,
			options,
		);
	}

	public processUnresolvedLinksInElement(el: HTMLElement, sourcePath: string): void {
		this.runtime.stylingService.decorateLinksInContainer(el, sourcePath);
	}
}
