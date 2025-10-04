import { Plugin, MarkdownView, WorkspaceLeaf, TFile } from "obsidian";
import { ComponentManager } from "./ComponentManager";
import { EventManager } from "./EventManager";
import { ViewManager } from "./ViewManager";

export default class AnotherTwoHopLinksPlugin extends Plugin {
	private componentManager: ComponentManager = new ComponentManager();
	private viewManager!: ViewManager;
	private eventManager!: EventManager;

	async onload() {
		console.log("Loading Example Plugin");

		this.viewManager = new ViewManager(this.app);

		this.eventManager = new EventManager(this, {
			onLayoutReady: () => {
				const leaf =
					this.app.workspace.getActiveViewOfType(MarkdownView)
						?.leaf || null;
				const file = this.viewManager.handleActiveLeafChange(leaf);
				if (leaf && file && leaf.view instanceof MarkdownView) {
					this.componentManager.mountComponentsForView(
						leaf.view as MarkdownView,
						file
					);
				}
			},
			onActiveLeafChange: (leaf) => {
				const file = this.viewManager.handleActiveLeafChange(leaf);
				if (leaf && file && leaf.view instanceof MarkdownView) {
					this.componentManager.mountComponentsForView(
						leaf.view as MarkdownView,
						file
					);
				}
			},
			onLayoutChange: () => {
				const activeViews = this.viewManager.getActiveMarkdownViews();
				this.componentManager.cleanupClosedViews(activeViews);
			},
		});

		this.eventManager.registerEvents();
	}

	onunload() {
		this.componentManager.cleanupAllComponents();
	}
}
