import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processBasesPaneSpy } = vi.hoisted(() => ({
	processBasesPaneSpy: vi.fn(),
}));

vi.mock("obsidian", () => {
	class MarkdownView {
		file:
			| {
					path: string;
			  }
			| undefined;
		editor:
			| {
					cm?: {
						dispatch: ReturnType<typeof vi.fn>;
					};
			  }
			| undefined;
		previewMode:
			| {
					containerEl?: HTMLElement;
			  }
			| undefined;
		containerEl = document.createElement("div");
		private mode: "source" | "preview" = "source";

		public setMode(mode: "source" | "preview"): void {
			this.mode = mode;
		}

		public getMode(): "source" | "preview" {
			return this.mode;
		}

		public getViewType(): string {
			return "markdown";
		}
	}

	class App {}

	return {
		App,
		getLinkpath: (linkText: string) =>
			linkText.replace(/^\[\[|\]\]$/g, "").split("|")[0],
		normalizePath: (path: string) => path.replace(/\\/g, "/"),
		MarkdownView,
	};
});

vi.mock("infrastructure/markdown/markdownHandlers", () => ({
	processBasesPane: processBasesPaneSpy,
	getBasesLinkLookupKey: (linkEl: HTMLElement): string | undefined => {
		const href =
			linkEl.getAttribute("data-href") ||
			linkEl.getAttribute("href") ||
			linkEl.parentElement?.getAttribute("data-href") ||
			linkEl.parentElement?.getAttribute("href") ||
			undefined;
		return href ? href.split("#")[0].toLowerCase() : undefined;
	},
}));

import { MarkdownView } from "obsidian";
import { createViewUpdateOrchestrator } from "../viewUpdateOrchestrator";

function createMarkdownLeaf(path: string, mode: "source" | "preview") {
	const view = new (MarkdownView as any)();
	view.file = { path };
	view.setMode(mode);
	view.containerEl = document.createElement("div");
	document.body.appendChild(view.containerEl);

	const dispatch = vi.fn();
	view.editor = mode === "source" ? { cm: { dispatch } } : undefined;

	if (mode === "source") {
		const sourceRoot = document.createElement("div");
		sourceRoot.className = "markdown-source-view";
		const livePreviewEl = document.createElement("div");
		livePreviewEl.className = "markdown-rendered";
		sourceRoot.appendChild(livePreviewEl);
		view.containerEl.appendChild(sourceRoot);
		return {
			leaf: { view },
			view,
			dispatch,
			sourceContainer: livePreviewEl,
		};
	}

	const previewContainer = document.createElement("div");
	view.previewMode = { containerEl: previewContainer };
	view.containerEl.appendChild(previewContainer);
	return { leaf: { view }, view, dispatch, previewContainer };
}

function createCanvasLeaf() {
	const matchedEditDispatch = vi.fn();
	const otherEditDispatch = vi.fn();
	const matchedPreviewEl = document.createElement("div");
	const textPreviewEl = document.createElement("div");

	const matchedEditNode = {
		file: { path: "notes/match.md" },
		contentEl: document.createElement("div"),
		child: {
			editMode: {
				cm: {
					dispatch: matchedEditDispatch,
				},
			},
		},
	};
	const otherEditNode = {
		file: { path: "notes/other.md" },
		contentEl: document.createElement("div"),
		child: {
			editMode: {
				cm: {
					dispatch: otherEditDispatch,
				},
			},
		},
	};
	const matchedPreviewNode = {
		file: { path: "notes/match.md" },
		contentEl: matchedPreviewEl,
		child: {},
	};
	const textNode = {
		contentEl: document.createElement("div"),
		child: {
			previewMode: {
				containerEl: textPreviewEl,
			},
		},
	};

	const view: any = {
		file: { path: "boards/board.canvas" },
		canvas: {
			nodes: new Map<string, any>([
				["matched-edit", matchedEditNode],
				["other-edit", otherEditNode],
				["matched-preview", matchedPreviewNode],
				["text-node", textNode],
			]),
		},
		getViewType: () => "canvas",
	};

	return {
		leaf: { view },
		matchedEditDispatch,
		otherEditDispatch,
		matchedPreviewEl,
		textPreviewEl,
	};
}

function createMocks(overrides?: { indexingService?: Record<string, unknown> }) {
	const app = {
		workspace: {
			iterateAllLeaves: vi.fn(),
			getActiveViewOfType: vi.fn(),
		},
	};
	const plugin = {
		forceRedrawEffect: {
			of: vi.fn(() => "force-redraw-effect"),
		},
		processUnresolvedLinksInElement: vi.fn(),
		indexingService: {
			getSourcePathsForLookupKeys: vi.fn(() => new Set<string>()),
			...overrides?.indexingService,
		},
	};
	const stylingService = {
		decorateLinksInContainer: vi.fn(),
	};
	const markdownRenderManager = {
		reprocessDecorations: vi.fn(),
		isTrackedElement: vi.fn(() => false),
		getTrackedSourcePaths: vi.fn(() => new Set<string>()),
	};
	const propertyStyleManager = {
		updateAll: vi.fn(),
		updateForPaths: vi.fn(),
	};

	return {
		app,
		plugin,
		stylingService,
		markdownRenderManager,
		propertyStyleManager,
	};
}

function createOrchestrator(mockDeps: ReturnType<typeof createMocks>) {
	return createViewUpdateOrchestrator({
		app: mockDeps.app as never,
		plugin: mockDeps.plugin as never,
		forceRedrawEffect: mockDeps.plugin.forceRedrawEffect as never,
		stylingService: mockDeps.stylingService as never,
		markdownRenderManager: mockDeps.markdownRenderManager as never,
		propertyStyleManager: mockDeps.propertyStyleManager as never,
	});
}

function expectUpdateForPathsCalledWith(
	propertyStyleManager: ReturnType<typeof createMocks>["propertyStyleManager"],
	expectedPaths: string[],
) {
	expect(propertyStyleManager.updateForPaths).toHaveBeenCalledTimes(1);
	const calledArg = propertyStyleManager.updateForPaths.mock
		.calls[0][0] as Set<string>;
	expect(Array.from(calledArg).sort()).toEqual([...expectedPaths].sort());
}

describe("ViewUpdateOrchestrator", () => {
	beforeEach(() => {
		processBasesPaneSpy.mockReset();
		document.body.innerHTML = "";
	});

	afterEach(() => {
		document.body.innerHTML = "";
		vi.clearAllMocks();
	});

	it("updates only matching markdown views and property widgets for affected paths", () => {
		const sourceMatch = createMarkdownLeaf("notes/match.md", "source");
		const sourceOther = createMarkdownLeaf("notes/other.md", "source");
		const previewMatch = createMarkdownLeaf("notes/match.md", "preview");
		const previewOther = createMarkdownLeaf("notes/other.md", "preview");
		const leaves = [
			sourceMatch.leaf,
			sourceOther.leaf,
			previewMatch.leaf,
			previewOther.leaf,
		];
		const mocks = createMocks();
		mocks.app.workspace.iterateAllLeaves.mockImplementation(
			(callback: (leaf: { view: unknown }) => void) => leaves.forEach(callback),
		);

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({
			affectedPaths: ["notes/match.md"],
			affectedLookupKeys: [],
		});

		expect(mocks.app.workspace.iterateAllLeaves).toHaveBeenCalledTimes(1);
		expect(mocks.markdownRenderManager.reprocessDecorations).toHaveBeenCalledTimes(
			1,
		);
		expect(mocks.markdownRenderManager.reprocessDecorations).toHaveBeenCalledWith(
			"notes/match.md",
		);
		expect(sourceMatch.dispatch).toHaveBeenCalledTimes(1);
		expect(sourceOther.dispatch).not.toHaveBeenCalled();
		expect(mocks.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			sourceMatch.sourceContainer,
			"notes/match.md",
		);
		expect(mocks.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			previewMatch.previewContainer,
			"notes/match.md",
		);
		expect(mocks.stylingService.decorateLinksInContainer).not.toHaveBeenCalledWith(
			expect.anything(),
			"notes/other.md",
		);
		expectUpdateForPathsCalledWith(mocks.propertyStyleManager, ["notes/match.md"]);
		expect(processBasesPaneSpy).not.toHaveBeenCalled();
	});

	it("treats missing affected fields as an all-view update", () => {
		const source = createMarkdownLeaf("notes/source.md", "source");
		const preview = createMarkdownLeaf("notes/preview.md", "preview");
		const leaves = [source.leaf, preview.leaf];
		const mocks = createMocks();
		mocks.markdownRenderManager.getTrackedSourcePaths.mockReturnValue(
			new Set(["notes/source.md", "notes/preview.md"]),
		);
		mocks.app.workspace.iterateAllLeaves.mockImplementation(
			(callback: (leaf: { view: unknown }) => void) => leaves.forEach(callback),
		);

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({});

		expect(mocks.app.workspace.iterateAllLeaves).toHaveBeenCalledTimes(2);
		expect(mocks.markdownRenderManager.reprocessDecorations).toHaveBeenCalledWith(
			"notes/source.md",
		);
		expect(mocks.markdownRenderManager.reprocessDecorations).toHaveBeenCalledWith(
			"notes/preview.md",
		);
		expect(source.dispatch).toHaveBeenCalledTimes(1);
		expect(mocks.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			source.sourceContainer,
			"notes/source.md",
		);
		expect(mocks.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			preview.previewContainer,
			"notes/preview.md",
		);
		expect(mocks.propertyStyleManager.updateAll).toHaveBeenCalledTimes(1);
	});

	it("updates only matching canvas nodes for affected paths", () => {
		const canvasLeaf = createCanvasLeaf();
		const mocks = createMocks();
		mocks.app.workspace.iterateAllLeaves.mockImplementation(
			(callback: (leaf: { view: unknown }) => void) => callback(canvasLeaf.leaf),
		);

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({
			affectedPaths: ["notes/match.md", "boards/board.canvas"],
			affectedLookupKeys: [],
		});

		expect(canvasLeaf.matchedEditDispatch).toHaveBeenCalledTimes(1);
		expect(canvasLeaf.otherEditDispatch).not.toHaveBeenCalled();
		expect(mocks.plugin.processUnresolvedLinksInElement).toHaveBeenCalledWith(
			canvasLeaf.matchedPreviewEl,
			"notes/match.md",
		);
		expect(mocks.plugin.processUnresolvedLinksInElement).toHaveBeenCalledWith(
			canvasLeaf.textPreviewEl,
			"boards/board.canvas",
		);
		expect(mocks.plugin.processUnresolvedLinksInElement).toHaveBeenCalledTimes(2);
	});

	it("updates markdown views and property widgets for lookup-key-only changes", () => {
		const sourceMatch = createMarkdownLeaf("notes/source.md", "source");
		const previewMatch = createMarkdownLeaf("notes/source.md", "preview");
		const sourceOther = createMarkdownLeaf("notes/other.md", "source");
		const previewOther = createMarkdownLeaf("notes/other.md", "preview");
		const leaves = [
			sourceMatch.leaf,
			previewMatch.leaf,
			sourceOther.leaf,
			previewOther.leaf,
		];
		const sourcePaths = new Set(["notes/source.md"]);
		const getSourcePathsForLookupKeys = vi.fn(() => sourcePaths);
		const mocks = createMocks({
			indexingService: { getSourcePathsForLookupKeys },
		});
		mocks.app.workspace.iterateAllLeaves.mockImplementation(
			(callback: (leaf: { view: unknown }) => void) => leaves.forEach(callback),
		);

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({
			affectedPaths: [],
			affectedLookupKeys: ["target.md"],
		});

		expect(getSourcePathsForLookupKeys).toHaveBeenCalledTimes(1);
		expect(mocks.markdownRenderManager.reprocessDecorations).toHaveBeenCalledTimes(
			1,
		);
		expect(mocks.markdownRenderManager.reprocessDecorations).toHaveBeenCalledWith(
			"notes/source.md",
		);
		expect(sourceMatch.dispatch).toHaveBeenCalledTimes(1);
		expect(sourceOther.dispatch).not.toHaveBeenCalled();
		expect(mocks.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			sourceMatch.sourceContainer,
			"notes/source.md",
		);
		expect(mocks.stylingService.decorateLinksInContainer).toHaveBeenCalledWith(
			previewMatch.previewContainer,
			"notes/source.md",
		);
		expectUpdateForPathsCalledWith(mocks.propertyStyleManager, ["notes/source.md"]);
	});

	it("updates canvas text nodes when only affected lookup keys match", () => {
		const canvasLeaf = createCanvasLeaf();
		const canvasLink = document.createElement("a");
		canvasLink.className = "internal-link";
		canvasLink.setAttribute("data-href", "match.md");
		canvasLeaf.textPreviewEl.appendChild(canvasLink);

		const mocks = createMocks();
		mocks.app.workspace.iterateAllLeaves.mockImplementation(
			(callback: (leaf: { view: unknown }) => void) => callback(canvasLeaf.leaf),
		);

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({
			affectedPaths: [],
			affectedLookupKeys: ["match.md"],
		});

		expect(mocks.plugin.processUnresolvedLinksInElement).toHaveBeenCalledTimes(1);
		expect(mocks.plugin.processUnresolvedLinksInElement).toHaveBeenCalledWith(
			canvasLeaf.textPreviewEl,
			"boards/board.canvas",
		);
		expect(canvasLeaf.matchedEditDispatch).not.toHaveBeenCalled();
		expect(canvasLeaf.otherEditDispatch).not.toHaveBeenCalled();
	});

	it("refreshes only bases panes whose lookup keys intersect the affected lookup keys", () => {
		const matchingPane = document.createElement("div");
		matchingPane.className = "bases-view";
		const matchingLink = document.createElement("a");
		matchingLink.className = "internal-link";
		matchingLink.setAttribute("data-href", "match.md");
		matchingPane.appendChild(matchingLink);
		document.body.appendChild(matchingPane);

		const otherPane = document.createElement("div");
		otherPane.className = "bases-view";
		const otherLink = document.createElement("a");
		otherLink.className = "internal-link";
		otherLink.setAttribute("data-href", "other.md");
		otherPane.appendChild(otherLink);
		document.body.appendChild(otherPane);

		const mocks = createMocks();
		mocks.app.workspace.iterateAllLeaves = vi.fn();

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({
			affectedPaths: [],
			affectedLookupKeys: ["match.md"],
		});

		expect(processBasesPaneSpy).toHaveBeenCalledTimes(1);
		expect(processBasesPaneSpy).toHaveBeenCalledWith(
			matchingPane,
			expect.any(Object),
			expect.any(Array),
		);
		expect(mocks.propertyStyleManager.updateForPaths).not.toHaveBeenCalled();
	});

	it("skips update when only affected tags are present", () => {
		const sourceMatch = createMarkdownLeaf("notes/match.md", "source");
		const previewMatch = createMarkdownLeaf("notes/match.md", "preview");
		const leaves = [sourceMatch.leaf, previewMatch.leaf];
		const mocks = createMocks();
		mocks.app.workspace.iterateAllLeaves.mockImplementation(
			(callback: (leaf: { view: unknown }) => void) => leaves.forEach(callback),
		);

		const orchestrator = createOrchestrator(mocks);

		orchestrator.updateForContext({
			affectedPaths: [],
			affectedLookupKeys: [],
			affectedTags: ["#tag1", "#tag2"],
		});

		expect(mocks.markdownRenderManager.reprocessDecorations).not.toHaveBeenCalled();
		expect(sourceMatch.dispatch).not.toHaveBeenCalled();
		expect(mocks.stylingService.decorateLinksInContainer).not.toHaveBeenCalled();
		expect(mocks.propertyStyleManager.updateAll).not.toHaveBeenCalled();
		expect(mocks.propertyStyleManager.updateForPaths).not.toHaveBeenCalled();
	});
});
