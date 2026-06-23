import { MarkdownView, WorkspaceLeaf, TFile, type Workspace } from "obsidian";

export interface WorkspaceViewQueries {
	getMarkdownViewFromLeaf(leaf: WorkspaceLeaf | undefined): MarkdownView | undefined;
	getFileFromLeaf(leaf: WorkspaceLeaf | undefined): TFile | undefined;
	getFileFromView(view: MarkdownView | undefined): TFile | undefined;
	getOpenMarkdownViews(): MarkdownView[];
}

export function createWorkspaceViewQueries(workspace: Workspace): WorkspaceViewQueries {
	return {
		getMarkdownViewFromLeaf,
		getFileFromLeaf,
		getFileFromView,
		getOpenMarkdownViews,
	};

	function getMarkdownViewFromLeaf(
		leaf: WorkspaceLeaf | undefined,
	): MarkdownView | undefined {
		if (!leaf) return undefined;
		return isValidMarkdownView(leaf.view) ? leaf.view : undefined;
	}

	function getFileFromLeaf(leaf: WorkspaceLeaf | undefined): TFile | undefined {
		const markdownView = getMarkdownViewFromLeaf(leaf);
		return getFileFromView(markdownView);
	}

	function getFileFromView(view: MarkdownView | undefined): TFile | undefined {
		return view?.file ?? undefined;
	}

	function getOpenMarkdownViews(): MarkdownView[] {
		const views: MarkdownView[] = [];
		for (const leaf of workspace.getLeavesOfType("markdown")) {
			if (isValidMarkdownView(leaf.view)) {
				views.push(leaf.view);
			}
		}
		return views;
	}
}

function isValidMarkdownView(view: unknown): view is MarkdownView {
	return view instanceof MarkdownView;
}
