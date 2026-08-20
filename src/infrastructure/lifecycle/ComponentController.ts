import { App, MarkdownView, TFile, WorkspaceLeaf, MarkdownRenderChild } from "obsidian";
import { unmount } from "svelte";
import {
	getActiveInlineContainer,
	type ActiveInlineContainer,
	type InlineMarkdownSurface,
} from "ui/shared/dom/domUtils";
import { getLeafId } from "infrastructure/workspace/workspaceLeafIdentity";
import * as ErrorHandler from "shared/errors/errorHandler";
import type { PluginSettings } from "features/settings/model";
import type { SortOption } from "core/sorting";
import type { IComponentManager } from "types/services";
import type { TwoHopLinkResult } from "types/domain";
import type { TwoHopApplicationStore } from "features/two-hop/application/TwoHopApplicationStore.svelte";
import type { DisplayDataBuilder } from "features/two-hop/application/displayDataBuilder";
import type { IIndexingService } from "types/services";
import type { PluginHost } from "types/pluginHost";
import type { ResolveTwoHopLinks } from "features/two-hop/application/TwoHopLinksLoader";
import { mountTwoHopLinksRootView } from "features/two-hop/ui/mountTwoHopLinksRootView";
import type { LinkContext } from "ui/context/linkContext";
import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";
import { createViewLinkContext } from "ui/shared/views/createViewLinkContext";
import type { TwoHopLinksRootUiState } from "features/two-hop/ui/twoHopLinksRootUiState";
import type { SvelteComponentInstance } from "ui/shared/views/svelteLifecycle";
import { createInlineSurfaceLayoutController } from "ui/shared/dom/inlineSurfaceLayoutController";
import { ApplicationStorePool } from "./ApplicationStorePool";

export { RECENT_APPLICATION_STORE_LIMIT } from "./ApplicationStorePool";

export type ComponentInstance = SvelteComponentInstance;

interface MountedComponent {
	component: SvelteComponentInstance | undefined;
	container: HTMLElement;
	surface: InlineMarkdownSurface;
	file: TFile;
	filePath: string;
	leafId: string;
	lifecycleManager: MarkdownRenderChild;
}

interface InlineViewUiState {
	filePath: string;
	uiState: TwoHopLinksRootUiState;
}

export interface ComponentControllerViewDeps {
	createDisplayDataBuilder(): DisplayDataBuilder;
	createLinkContext(file: TFile, settings: PluginSettings): LinkContext;
	readonly previewRuntime: PreviewRuntime;
}

export class ComponentController implements IComponentManager {
	private readonly mountedComponents = new WeakMap<
		MarkdownView,
		MountedComponent[]
	>();
	private readonly lazyLoaderCaches = new WeakMap<MarkdownView, Set<string>>();
	private readonly inlineUiStates = new WeakMap<MarkdownView, InlineViewUiState>();

	private readonly applicationStorePool: ApplicationStorePool;

	constructor(
		private readonly app: App,
		private readonly plugin: PluginHost,
		private readonly getSettings: () => PluginSettings,
		private readonly resolveTwoHopLinks: ResolveTwoHopLinks,
		indexingService: IIndexingService,
		updateSortOption: (option: SortOption) => void,
		private readonly viewDeps: ComponentControllerViewDeps,
		updateContentSearch: (enabled: boolean) => void = () => {},
	) {
		this.applicationStorePool = new ApplicationStorePool({
			indexingService,
			createDisplayDataBuilder: viewDeps.createDisplayDataBuilder,
			updateSortOption,
			updateContentSearch,
		});
	}

	private getLazyLoaderCache(view: MarkdownView): Set<string> {
		if (!this.lazyLoaderCaches.has(view)) {
			this.lazyLoaderCaches.set(view, new Set<string>());
		}
		return this.lazyLoaderCaches.get(view)!;
	}

	private clearLazyLoaderCache(view: MarkdownView): void {
		this.lazyLoaderCaches.get(view)?.clear();
	}

	private getInlineUiState(
		view: MarkdownView,
		filePath: string,
	): TwoHopLinksRootUiState {
		let viewState = this.inlineUiStates.get(view);
		if (!viewState || viewState.filePath !== filePath) {
			viewState = {
				filePath,
				uiState: { searchInputValue: "" },
			};
			this.inlineUiStates.set(view, viewState);
		}

		return viewState.uiState;
	}

	private clearInlineUiState(view: MarkdownView): void {
		this.inlineUiStates.delete(view);
	}

	mountComponentsForView(
		view: MarkdownView,
		file: TFile | undefined,
		options?: {
			skipIfMounted?: boolean;
		},
	): void {
		if (!file) {
			this.unmountViewComponents(view);
			this.clearLazyLoaderCache(view);
			this.clearInlineUiState(view);
			return;
		}

		const target = getActiveInlineContainer(view);
		if (!target) {
			return;
		}

		const mountedList = this.mountedComponents.get(view) ?? [];
		const previousFilePath = mountedList[0]?.filePath;
		const sameTargetMounted =
			mountedList.length === 1 &&
			mountedList[0].filePath === file.path &&
			mountedList[0].surface === target.surface &&
			mountedList[0].container === target.container &&
			mountedList[0].container.isConnected;

		if (options?.skipIfMounted && sameTargetMounted) {
			return;
		}

		if (previousFilePath && previousFilePath !== file.path) {
			this.clearLazyLoaderCache(view);
			this.clearInlineUiState(view);
		}

		this.syncComponentForView(view, file, target);
	}

	unmountViewComponents(view: MarkdownView): void {
		const mountedList = this.mountedComponents.get(view);
		if (!mountedList?.length) {
			return;
		}

		this.unloadMountedComponents(view, mountedList);
		this.mountedComponents.delete(view);
	}

	private unloadMountedComponents(
		view: MarkdownView,
		mountedList: readonly MountedComponent[],
	): void {
		for (const mounted of mountedList) {
			mounted.lifecycleManager.unload();
			view.removeChild(mounted.lifecycleManager);
		}
	}

	/**
	 * MarkdownViewからLeafを取得
	 */
	private getLeafFromView(view: MarkdownView): WorkspaceLeaf | undefined {
		const leaves = this.app.workspace.getLeavesOfType("markdown");
		return leaves.find((leaf) => leaf.view === view) ?? undefined;
	}

	public createApplicationStore(
		settings: PluginSettings,
		buildDisplayData: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): TwoHopApplicationStore {
		return this.applicationStorePool.create(
			settings,
			buildDisplayData,
			resolveTwoHopLinks,
		);
	}

	public getOrCreateApplicationStore(
		leafId: string,
		filePath: string,
		settings: PluginSettings,
		buildDisplayData: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): TwoHopApplicationStore {
		return this.applicationStorePool.acquire(
			leafId,
			filePath,
			settings,
			buildDisplayData,
			resolveTwoHopLinks,
		);
	}

	public clearStore(leafId: string, filePath: string): void {
		this.applicationStorePool.clearIdleStore(leafId, filePath);
	}

	// ========== Component Lifecycle Management ==========

	private syncComponentForView(
		view: MarkdownView,
		file: TFile,
		target: ActiveInlineContainer,
	): void {
		const previous = this.mountedComponents.get(view) ?? [];
		// Leafを取得してLeafIDを生成
		const leaf = this.getLeafFromView(view);
		if (!leaf) {
			console.warn("Could not find leaf for view");
			return;
		}

		const leafId = getLeafId(leaf);
		if (!leafId) {
			console.warn("Could not get leaf id");
			return;
		}

		const usesSameContainer = previous.some(
			(mounted) => mounted.container === target.container,
		);
		if (usesSameContainer) {
			this.unloadMountedComponents(view, previous);
			this.mountedComponents.delete(view);
		}

		const next = this.mountComponent(
			target.container,
			target.surface,
			file,
			leafId,
			view,
		);
		this.mountedComponents.set(view, [next]);

		if (!usesSameContainer) {
			this.unloadMountedComponents(view, previous);
		}
	}

	private mountComponent(
		container: HTMLElement,
		surface: InlineMarkdownSurface,
		file: TFile,
		leafId: string,
		view: MarkdownView,
	): MountedComponent {
		let applicationStore: TwoHopApplicationStore | undefined;
		let shouldReleaseStoreOnError = false;
		const layoutController = createInlineSurfaceLayoutController({
			container,
			surface,
		});

		try {
			const settings = this.getSettings();

			// Viewに紐づいたキャッシュを取得
			const lazyLoaderCache = this.getLazyLoaderCache(view);

			applicationStore = this.getOrCreateApplicationStore(
				leafId,
				file.path,
				settings,
				this.applicationStorePool.getOrCreateDisplayDataBuilder(leafId),
				this.resolveTwoHopLinks,
			);
			shouldReleaseStoreOnError = true;

			const linkContext = createViewLinkContext(
				this.viewDeps.createLinkContext(file, settings),
				() => {},
			);
			const { component } = mountTwoHopLinksRootView({
				target: container,
				app: this.app,
				file,
				settings,
				applicationStore,
				linkContext,
				previewRuntime: this.viewDeps.previewRuntime,
				lazyLoaderCache,
				updateSetting: (key, value) => this.plugin.updateSetting(key, value),
				uiState: this.getInlineUiState(view, file.path),
			});

			// --- ライフサイクル管理 ---
			// MarkdownRenderChildを使って、Viewが破棄されたとき(タブ閉じ等)に
			// 自動的にクリーンアップ処理が走るようにする
			const lifecycleManager = new MarkdownRenderChild(container as HTMLElement);

			// 既にクリーンアップされたかを追跡するフラグ（二重解放防止）
			let isCleanedUp = false;

			lifecycleManager.onunload = () => {
				if (isCleanedUp) return;
				isCleanedUp = true;

				this.unmountComponent(component);
				layoutController.dispose();

				this.applicationStorePool.release(leafId, file.path);
			};

			// Viewに子要素として登録することで、Viewのライフサイクルと連動させる
			view.addChild(lifecycleManager);
			shouldReleaseStoreOnError = false;

			return {
				component,
				container,
				surface,
				file,
				filePath: file.path,
				leafId,
				lifecycleManager,
			};
		} catch (error) {
			layoutController.dispose();
			if (shouldReleaseStoreOnError) {
				this.applicationStorePool.dispose(leafId, file.path);
			}
			ErrorHandler.handleMountError(error, file.path);
			throw error;
		}
	}

	/**
	 * Svelteコンポーネント単体のアンマウント処理
	 */
	private unmountComponent(component: SvelteComponentInstance | undefined): void {
		if (!component) {
			return;
		}

		try {
			// Svelteのunmountを使用
			unmount(component);
		} catch (error) {
			ErrorHandler.handleUnmountError(error);
		}
	}

	// プラグインアンロード時に呼ばれる
	destroy(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				this.clearLazyLoaderCache(leaf.view);
				const mountedList = this.mountedComponents.get(leaf.view);
				if (mountedList) {
					for (const mounted of mountedList) {
						// MarkdownRenderChild経由でアンロードを発火させる
						mounted.lifecycleManager.unload();

						if (mounted.container?.isConnected) {
							mounted.container.remove();
						}
					}
				}
				this.mountedComponents.delete(leaf.view);
			}
		});

		this.applicationStorePool.destroy();
	}
}
