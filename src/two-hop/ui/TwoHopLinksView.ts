import { ItemView, WorkspaceLeaf, TFile, type IconName } from "obsidian";
import type { PluginHost } from "obsidian-integration/pluginHost";
import type { TwoHopState } from "two-hop/state/TwoHopState.svelte";
import type { ViewServices } from "obsidian-integration/views/viewServices";
import {
	createDefaultTwoHopState,
	createLinkContextForView,
} from "obsidian-integration/views/viewFactories";
import {
	cleanupSvelteAndStore,
	type SvelteComponentInstance,
} from "obsidian-integration/views/svelteLifecycle";
import { mountTwoHopLinksRootView } from "./mountTwoHopLinksRootView";

export const TWO_HOP_LINKS_VIEW_TYPE = "cosense-card-links-view";

export class TwoHopLinksView extends ItemView {
	private component: SvelteComponentInstance | undefined = undefined;
	private applicationStore: TwoHopState | undefined = undefined;
	private currentFile: TFile | undefined = undefined;
	private lazyLoaderCache: Set<string> = new Set();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: PluginHost,
		private readonly viewServices: ViewServices,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TWO_HOP_LINKS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Cosense card links";
	}

	getIcon(): IconName {
		return "network";
	}

	async onOpen(): Promise<void> {
		this.clearContent();
	}

	public renderForFile(file: TFile): void {
		this.renderFile(file, { force: false });
	}

	public refreshFromSettings(): void {
		if (!this.currentFile) {
			return;
		}

		this.renderFile(this.currentFile, { force: true });
	}

	private renderFile(file: TFile, options: { force: boolean }): void {
		const isFileTransition = this.currentFile?.path !== file.path;

		// ファイルが同じ場合は再レンダリングをスキップ
		if (!options.force && !isFileTransition && this.component) {
			return;
		}

		// ファイル遷移時は LazyLoader キャッシュを破棄し、不要な参照保持を避ける
		if (isFileTransition) {
			this.lazyLoaderCache.clear();
		}

		this.currentFile = file;

		[this.component, this.applicationStore] = cleanupSvelteAndStore(
			this.component,
			this.applicationStore,
		);

		const container = this.contentEl;
		container.empty();

		if (isFileTransition) {
			this.resetSidebarScrollPosition();
		}

		const applicationStore = createDefaultTwoHopState(
			this.viewServices,
			this.plugin.settings,
		);
		const linkContext = createLinkContextForView(
			this.viewServices,
			file,
			this.plugin.settings,
			{ wrapForView: false },
		);

		({ component: this.component, applicationStore: this.applicationStore } =
			mountTwoHopLinksRootView({
				target: container,
				app: this.plugin.app,
				file,
				settings: this.plugin.settings,
				applicationStore,
				linkContext,
				previewRuntime: this.viewServices.previewRuntime,
				lazyLoaderCache: this.lazyLoaderCache,
				keyboardNavigationSurfaceRegistry:
					this.viewServices.keyboardNavigationSurfaceRegistry,
				isSidebar: true,
				updateSetting: (key, value) => this.plugin.updateSetting(key, value),
			}));
	}

	/**
	 * ビューのコンテンツをクリアし、プレースホルダーを表示します。
	 * hybridモードでUIを非表示にする際に使用されます。
	 */
	public clearContent(): void {
		this.currentFile = undefined;
		this.lazyLoaderCache.clear();
		[this.component, this.applicationStore] = cleanupSvelteAndStore(
			this.component,
			this.applicationStore,
		);
		this.contentEl.empty();
		this.resetSidebarScrollPosition();
		this.contentEl.createDiv({
			text: "Open a non-Markdown file to see links.",
			cls: "cosense-card-links__sidebar-placeholder",
			attr: {
				style: "padding: 20px; text-align: center; color: var(--text-muted);",
			},
		});
	}

	private resetSidebarScrollPosition(): void {
		this.contentEl.scrollTop = 0;
	}

	async onClose(): Promise<void> {
		[this.component, this.applicationStore] = cleanupSvelteAndStore(
			this.component,
			this.applicationStore,
		);
		this.currentFile = undefined;
		this.lazyLoaderCache.clear();
	}
}
