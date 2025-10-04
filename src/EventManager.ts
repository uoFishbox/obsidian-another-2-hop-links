import { Plugin, MarkdownView, WorkspaceLeaf, TFile } from "obsidian";

export interface EventCallbacks {
	onLayoutReady: () => void;
	onActiveLeafChange: (leaf: WorkspaceLeaf | null) => void;
	onLayoutChange: () => void;
}

export class EventManager {
	private plugin: Plugin;
	private callbacks: EventCallbacks;

	constructor(plugin: Plugin, callbacks: EventCallbacks) {
		this.plugin = plugin;
		this.callbacks = callbacks;
	}

	registerEvents(): void {
		// Obsidianのレイアウト準備完了後に、最初にアクティブなビューにマウント
		this.plugin.app.workspace.onLayoutReady(() => {
			this.callbacks.onLayoutReady();
		});

		// アクティブなLeafが変更されたときにコンポーネントをマウント/更新
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", (leaf) => {
				this.callbacks.onActiveLeafChange(leaf);
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.workspace.on("layout-change", () => {
				this.callbacks.onLayoutChange();
			})
		);
	}
}
