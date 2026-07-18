import { App, MarkdownView, TFile, WorkspaceLeaf, MarkdownRenderChild } from "obsidian";
import { unmount } from "svelte";
import {
	getActiveInlineContainer,
	type ActiveInlineContainer,
	type InlineMarkdownSurface,
} from "ui/utils/domUtils";
import { getLeafId } from "infrastructure/utils/workspaceUtils";
import * as ErrorHandler from "utils/errorHandler";
import type { PluginSettings, SortOption } from "types/settings";
import { areTagFeaturesEnabled } from "types/settings";
import type { IComponentManager } from "types/services";
import type { TwoHopLinkResult } from "types/domain";
import type { DisplayDataBuilder } from "ui/stores/ApplicationStore.svelte";
import { IndexingService } from "core/indexing/index-service/IndexingService";
import { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { PluginHostUi } from "types/pluginHostUi";
import type { ResolveTwoHopLinks } from "ui/stores/application/TwoHopLinksLoader";
import { mountTwoHopLinksRootView } from "ui/views/shared/viewFactories";
import type { SvelteComponentInstance } from "ui/views/shared/svelteLifecycle";

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

export const RECENT_APPLICATION_STORE_LIMIT = 6;

export class ComponentController implements IComponentManager {
	private readonly mountedComponents = new WeakMap<
		MarkdownView,
		MountedComponent[]
	>();
	private readonly lazyLoaderCaches = new WeakMap<MarkdownView, Set<string>>();

	private readonly applicationStores = new Map<string, ApplicationStore>();
	private readonly applicationStoreRefCounts = new Map<string, number>();
	private readonly applicationStoreLastAccess = new Map<string, number>();
	private readonly displayDataBuilders = new Map<string, DisplayDataBuilder>();
	private applicationStoreAccessSequence = 0;

	constructor(
		private readonly app: App,
		private readonly plugin: PluginHostUi,
		private readonly getSettings: () => PluginSettings,
		private readonly indexingService: IndexingService,
		private readonly updateSortOption: (option: SortOption) => void,
		private readonly updateContentSearch: (enabled: boolean) => void = () => {},
	) {}

	private getLazyLoaderCache(view: MarkdownView): Set<string> {
		if (!this.lazyLoaderCaches.has(view)) {
			this.lazyLoaderCaches.set(view, new Set<string>());
		}
		return this.lazyLoaderCaches.get(view)!;
	}

	private clearLazyLoaderCache(view: MarkdownView): void {
		this.lazyLoaderCaches.get(view)?.clear();
	}

	private buildStoreKey(leafId: string, filePath: string): string {
		return `${leafId}:${filePath}`;
	}

	private buildLeafStoreKeyPrefix(leafId: string): string {
		return `${leafId}:`;
	}

	private touchApplicationStore(key: string): void {
		this.applicationStoreLastAccess.set(key, ++this.applicationStoreAccessSequence);
	}

	private getOrCreateDisplayDataBuilder(leafId: string): DisplayDataBuilder {
		let displayDataBuilder = this.displayDataBuilders.get(leafId);
		if (!displayDataBuilder) {
			displayDataBuilder = this.plugin.createDisplayDataBuilder();
			this.displayDataBuilders.set(leafId, displayDataBuilder);
		}
		return displayDataBuilder;
	}

	private hasStoresForLeaf(leafId: string): boolean {
		const prefix = this.buildLeafStoreKeyPrefix(leafId);
		for (const key of this.applicationStores.keys()) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}

	private maybeReleaseDisplayDataBuilder(leafId: string): void {
		if (!this.hasStoresForLeaf(leafId)) {
			this.displayDataBuilders.delete(leafId);
		}
	}

	private deleteApplicationStoreEntry(key: string): void {
		this.applicationStores.delete(key);
		this.applicationStoreRefCounts.delete(key);
		this.applicationStoreLastAccess.delete(key);
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

	/**
	 * ApplicationStoreを作成
	 */
	public createApplicationStore(
		settings: PluginSettings,
		buildDisplayData: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore {
		const store = new ApplicationStore(
			settings,
			buildDisplayData,
			resolveTwoHopLinks,
			this.updateSortOption,
			this.updateContentSearch,
		);

		// IndexingServiceのデータ更新を購読
		const unsubscribe = this.indexingService.onDataUpdate((context) => {
			store.handleDataUpdate(context);
		});
		store.subscribeToDataUpdates(unsubscribe);

		return store;
	}

	/**
	 * ApplicationStoreを取得または作成
	 */
	public getOrCreateApplicationStore(
		leafId: string,
		filePath: string,
		settings: PluginSettings,
		buildDisplayData: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore {
		const key = this.buildStoreKey(leafId, filePath);
		let store = this.applicationStores.get(key);
		if (!store) {
			store = this.createApplicationStore(
				settings,
				buildDisplayData,
				resolveTwoHopLinks,
			);
			this.applicationStores.set(key, store);
		}
		this.touchApplicationStore(key);
		this.applicationStoreRefCounts.set(
			key,
			(this.applicationStoreRefCounts.get(key) ?? 0) + 1,
		);
		return store;
	}

	/**
	 * Storeをクリア
	 */
	public clearStore(leafId: string, filePath: string): void {
		const key = this.buildStoreKey(leafId, filePath);
		const refCount = this.applicationStoreRefCounts.get(key) ?? 0;
		if (refCount > 0) {
			return;
		}

		const store = this.applicationStores.get(key);
		store?.destroy();
		this.deleteApplicationStoreEntry(key);
		this.maybeReleaseDisplayDataBuilder(leafId);
	}

	private releaseApplicationStore(leafId: string, filePath: string): void {
		const key = this.buildStoreKey(leafId, filePath);
		const store = this.applicationStores.get(key);
		if (!store) {
			this.applicationStoreRefCounts.delete(key);
			return;
		}

		const nextRefCount = (this.applicationStoreRefCounts.get(key) ?? 0) - 1;
		if (nextRefCount > 0) {
			this.applicationStoreRefCounts.set(key, nextRefCount);
			return;
		}

		this.applicationStoreRefCounts.set(key, 0);
		this.touchApplicationStore(key);
		this.trimIdleApplicationStores();
	}

	private disposeApplicationStore(leafId: string, filePath: string): void {
		const key = this.buildStoreKey(leafId, filePath);
		const store = this.applicationStores.get(key);
		if (!store) {
			this.deleteApplicationStoreEntry(key);
			this.maybeReleaseDisplayDataBuilder(leafId);
			return;
		}

		const nextRefCount = (this.applicationStoreRefCounts.get(key) ?? 0) - 1;
		if (nextRefCount > 0) {
			this.applicationStoreRefCounts.set(key, nextRefCount);
			return;
		}

		store.destroy();
		this.deleteApplicationStoreEntry(key);
		this.maybeReleaseDisplayDataBuilder(leafId);
	}

	private trimIdleApplicationStores(): void {
		const idleEntries = Array.from(this.applicationStores.entries())
			.filter(([key]) => (this.applicationStoreRefCounts.get(key) ?? 0) === 0)
			.map(([key, store]) => ({
				key,
				store,
				lastAccess: this.applicationStoreLastAccess.get(key) ?? 0,
			}));

		if (idleEntries.length <= RECENT_APPLICATION_STORE_LIMIT) {
			return;
		}

		idleEntries.sort((left, right) => left.lastAccess - right.lastAccess);
		const evictionCount = idleEntries.length - RECENT_APPLICATION_STORE_LIMIT;

		for (const { key, store } of idleEntries.slice(0, evictionCount)) {
			store.destroy();
			this.deleteApplicationStoreEntry(key);
			const separatorIndex = key.indexOf(":");
			if (separatorIndex !== -1) {
				this.maybeReleaseDisplayDataBuilder(key.slice(0, separatorIndex));
			}
		}
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
		let applicationStore: ApplicationStore | undefined;
		let shouldReleaseStoreOnError = false;

		try {
			const settings = this.getSettings();

			// Viewに紐づいたキャッシュを取得
			const lazyLoaderCache = this.getLazyLoaderCache(view);

			applicationStore = this.getOrCreateApplicationStore(
				leafId,
				file.path,
				settings,
				this.getOrCreateDisplayDataBuilder(leafId),
				(targetFile: TFile, onProgress) => {
					const currentSettings = this.getSettings();
					return this.plugin.getTwoHopLinkResult(targetFile, onProgress, {
						includeTaggedNotes:
							areTagFeaturesEnabled(currentSettings) &&
							currentSettings.showTagsSection,
					});
				},
			);
			shouldReleaseStoreOnError = true;

			const { component } = mountTwoHopLinksRootView({
				target: container,
				plugin: this.plugin,
				file,
				settings,
				lazyLoaderCache,
				getApplicationStore: () => applicationStore!,
				updateSetting: (key, value) =>
					this.plugin.updateSetting(key as any, value),
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

				this.releaseApplicationStore(leafId, file.path);
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
			if (shouldReleaseStoreOnError) {
				this.disposeApplicationStore(leafId, file.path);
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

		for (const store of this.applicationStores.values()) {
			store.destroy();
		}
		this.applicationStores.clear();
		this.applicationStoreRefCounts.clear();
		this.applicationStoreLastAccess.clear();
		this.displayDataBuilders.clear();
	}
}
