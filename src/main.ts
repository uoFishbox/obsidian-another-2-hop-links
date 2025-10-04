import { Plugin, MarkdownView, WorkspaceLeaf, TFile } from "obsidian";
import { ComponentManager } from "./ComponentManager";
import { ViewManager } from "./ViewManager";

export default class AnotherTwoHopLinksPlugin extends Plugin {
	private componentManager: ComponentManager = new ComponentManager();
	private viewManager!: ViewManager;

	async onload() {
		console.log("Loading Example Plugin");

		this.viewManager = new ViewManager(this.app);

		// Obsidianのレイアウト準備完了後に、最初にアクティブなビューにマウント
		this.app.workspace.onLayoutReady(() => {
			const leaf =
				this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ||
				null;
			const file = this.viewManager.handleActiveLeafChange(leaf);
			if (leaf && file && leaf.view instanceof MarkdownView) {
				this.componentManager.mountComponentsForView(
					leaf.view as MarkdownView,
					file
				);
			}
		});

		// アクティブなLeafが変更されたときにコンポーネントをマウント/更新
		this.registerEvent(
			this.app.workspace.on(
				"active-leaf-change",
				(leaf: WorkspaceLeaf | null) => {
					const file = this.viewManager.handleActiveLeafChange(leaf);
					if (leaf && file && leaf.view instanceof MarkdownView) {
						this.componentManager.mountComponentsForView(
							leaf.view as MarkdownView,
							file
						);
					}
				}
			)
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const activeViews = this.viewManager.getActiveMarkdownViews();
				this.componentManager.cleanupClosedViews(activeViews);
			})
		);
	}

	onunload() {
		this.componentManager.cleanupAllComponents();
	}
}
