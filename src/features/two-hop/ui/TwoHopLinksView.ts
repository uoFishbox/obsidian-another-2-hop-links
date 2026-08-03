import { ItemView, WorkspaceLeaf, TFile, type IconName } from "obsidian";
import type { PluginHostUi } from "types/pluginHostUi";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import {
	cleanupSvelteAndStore,
	type SvelteComponentInstance,
} from "ui/shared/views/svelteLifecycle";
import { mountTwoHopLinksRootView } from "./mountTwoHopLinksRootView";

export const TWO_HOP_LINKS_VIEW_TYPE = "cosense-card-links-view";

export class TwoHopLinksView extends ItemView {
	private component: SvelteComponentInstance | undefined = undefined;
	private applicationStore: ApplicationStore | undefined = undefined;
	private currentFile: TFile | undefined = undefined;
	private lazyLoaderCache: Set<string> = new Set();

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: PluginHostUi,
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

		({ component: this.component, applicationStore: this.applicationStore } =
			mountTwoHopLinksRootView({
				target: container,
				plugin: this.plugin,
				file,
				settings: this.plugin.settings,
				lazyLoaderCache: this.lazyLoaderCache,
				isSidebar: true,
				wrapForView: false,
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
