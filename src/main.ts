import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import { ComponentManager } from "./ComponentManager";
import { ViewManager } from "./ViewManager";

export default class AnotherTwoHopLinksPlugin extends Plugin {
	private componentManager: ComponentManager = new ComponentManager();
	private viewManager!: ViewManager;
	private debouncedSync: (() => void) | null = null;

	private syncAllMarkdownViews(): void {
		const views = this.viewManager.getOpenMarkdownViews();
		for (const view of views) {
			const file = this.viewManager.getFileFromView(view);
			this.componentManager.mountComponentsForView(view, file);
		}
	}

	private debounce(func: () => void, delay: number): () => void {
		let timeoutId: NodeJS.Timeout | null = null;
		return () => {
			if (timeoutId) clearTimeout(timeoutId);
			timeoutId = setTimeout(func, delay);
		};
	}

	async onload() {
		console.log("Loading Example Plugin");

		this.viewManager = new ViewManager(this.app);
		this.debouncedSync = this.debounce(
			this.syncAllMarkdownViews.bind(this),
			0
		);

		// Obsidianのレイアウト準備完了後に、最初にアクティブなビューにマウント
		this.app.workspace.onLayoutReady(() => {
			this.syncAllMarkdownViews();
		});

		// アクティブなLeafが変更されたときにコンポーネントをマウント/更新
		this.registerEvent(
			this.app.workspace.on(
				"active-leaf-change",
				(_leaf: WorkspaceLeaf | null) => {
					this.debouncedSync!();
				}
			)
		);

		this.registerEvent(
			this.app.workspace.on("file-open", (_file: TFile | null) => {
				this.debouncedSync!();
			})
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				this.debouncedSync!();
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file) => {
				if (file instanceof TFile) {
					this.debouncedSync!();
				}
			})
		);
	}

	onunload() {}
}
