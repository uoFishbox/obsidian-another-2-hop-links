import { App, MarkdownView, WorkspaceLeaf, TFile } from "obsidian";

export class ViewManager {
	constructor(private app: App) {}

	getMarkdownViewFromLeaf(leaf: WorkspaceLeaf | null): MarkdownView | null {
		if (!leaf) return null;
		const { view } = leaf;
		if (!(view instanceof MarkdownView)) {
			return null;
		}
		return view;
	}

	getFileFromLeaf(leaf: WorkspaceLeaf | null): TFile | null {
		return this.getMarkdownViewFromLeaf(leaf)?.file ?? null;
	}

	getFileFromView(view: MarkdownView | null): TFile | null {
		return view?.file ?? null;
	}

	getOpenMarkdownViews(): MarkdownView[] {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf: WorkspaceLeaf) => leaf.view)
			.filter(
				(view: WorkspaceLeaf["view"]): view is MarkdownView =>
					view instanceof MarkdownView
			);
	}
}
