import { MarkdownView, WorkspaceLeaf, TFile } from "obsidian";

export class ViewManager {
	constructor(private app: any) {}

	handleActiveLeafChange(leaf: WorkspaceLeaf | null): TFile | null {
		if (!leaf) return null;

		const view = leaf.view;

		// いまのところMarkdownのみ
		if (!(view instanceof MarkdownView)) {
			return null;
		}

		const currentFile = view.file;
		return currentFile || null;
	}

	getActiveMarkdownViews(): MarkdownView[] {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf: WorkspaceLeaf) => leaf.view)
			.filter((view: any) => view instanceof MarkdownView);
	}

	isViewActive(view: MarkdownView): boolean {
		return this.getActiveMarkdownViews().includes(view);
	}
}
