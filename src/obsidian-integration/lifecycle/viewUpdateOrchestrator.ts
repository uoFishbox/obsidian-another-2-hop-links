import { MarkdownView } from "obsidian";
import type { App } from "obsidian";
import type { StateEffectType } from "@codemirror/state";
import type { CanvasView } from "obsidian-typings";
import {
	dataUpdateCollectionSize,
	toDataUpdateSet,
	type DataUpdateContext,
} from "indexing/index-service/IndexEvents";
import type { StylingService } from "obsidian-integration/link-decoration/stylingService";
import type { RenderedMdElementsRegistry } from "../markdown/RenderedMdElementsRegistry";
import type { PropertyWidgetStyler } from "../../obsidian-integration/link-decoration/propertyWidgetStyler";
import type { IIndexingService } from "indexing/index-service/IndexingService";
import {
	getBasesLinkLookupKey,
	processBasesPane,
} from "obsidian-integration/markdown/markdownHandlers";
import {
	normalizeHrefToLookupPath,
	toCaseInsensitiveLookupKey,
} from "indexing/link-resolution/linkResolution";
import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";
import { collectWorkspaceDocuments } from "obsidian-integration/workspace/workspaceDocuments";

const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

export interface ViewUpdateOrchestrator {
	updateAllViews(): void;
	updateForContext(context?: DataUpdateContext): void;
	updateActiveMarkdownViewDecorations(): void;
}

export interface ViewUpdateOrchestratorDeps {
	app: App;
	indexingService: IIndexingService;
	forceRedrawEffect: StateEffectType<undefined>;
	stylingService: StylingService;
	markdownRenderManager: RenderedMdElementsRegistry;
	propertyStyleManager: PropertyWidgetStyler;
}

export function createViewUpdateOrchestrator(
	deps: ViewUpdateOrchestratorDeps,
): ViewUpdateOrchestrator {
	const {
		app,
		indexingService,
		forceRedrawEffect,
		stylingService,
		markdownRenderManager,
		propertyStyleManager,
	} = deps;

	function updateAllViews(): void {
		reprocessTrackedMarkdownDecorations(
			markdownRenderManager.getTrackedSourcePaths(),
		);
		updateWorkspaceViews();
		updateBasesPanes();
		propertyStyleManager.updateAll();
	}

	function updateForContext(context?: DataUpdateContext): void {
		if (!context || context.affectsAll) {
			updateAllViews();
			return;
		}

		const affectedPaths = toDataUpdateSet(context.affectedPaths);
		const affectedLookupKeys = toDataUpdateSet(context.affectedLookupKeys);
		const affectedTags = context.affectedTags;
		const affectedPathCount = dataUpdateCollectionSize(context.affectedPaths);
		const affectedLookupKeyCount = dataUpdateCollectionSize(
			context.affectedLookupKeys,
		);

		const hasPathOrLookupImpact =
			affectedPathCount > 0 || affectedLookupKeyCount > 0;

		const hasOnlyTagImpact =
			!hasPathOrLookupImpact && dataUpdateCollectionSize(affectedTags) > 0;

		if (hasOnlyTagImpact) {
			return;
		}

		if (affectedPathCount === 0 && affectedLookupKeyCount === 0) {
			updateAllViews();
			return;
		}

		const affectedPathSet = affectedPaths ?? EMPTY_STRING_SET;
		const affectedLookupKeySet = affectedLookupKeys ?? EMPTY_STRING_SET;
		const refreshSourcePathSet = collectRefreshSourcePaths(
			affectedPathSet,
			affectedLookupKeySet,
		);

		for (const sourcePath of refreshSourcePathSet) {
			markdownRenderManager.reprocessDecorations(sourcePath);
		}

		updateWorkspaceViews(refreshSourcePathSet, affectedLookupKeySet);
		updateBasesPanes(affectedLookupKeySet);
		if (refreshSourcePathSet.size > 0) {
			propertyStyleManager.updateForPaths(refreshSourcePathSet);
		}
	}

	function updateActiveMarkdownViewDecorations(): void {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.file) {
			return;
		}

		const sourcePath = activeView.file.path;
		if (activeView.getMode() === "source") {
			const cm = activeView.editor?.cm;
			if (cm) {
				cm.dispatch({
					effects: forceRedrawEffect.of(undefined),
				});
			}

			markdownRenderManager.reprocessDecorations(sourcePath);
			decorateLivePreviewPostProcessorContainers(activeView, sourcePath);
			return;
		}

		if (activeView.getMode() === "preview") {
			markdownRenderManager.reprocessDecorations(sourcePath);
			const previewContainer = getPreviewContainerForReadingView(activeView);
			if (
				previewContainer &&
				previewContainer.isConnected &&
				!markdownRenderManager.isTrackedElement(sourcePath, previewContainer)
			) {
				stylingService.decorateLinksInContainer(previewContainer, sourcePath);
			}
		}
	}

	function updateWorkspaceViews(
		affectedPaths?: ReadonlySet<string>,
		affectedLookupKeys?: ReadonlySet<string>,
	): void {
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				updateMarkdownView(view, affectedPaths);
				return;
			}

			if (view.getViewType() === "canvas") {
				updateCanvasView(view as CanvasView, affectedPaths, affectedLookupKeys);
			}
		});
	}

	function updateMarkdownView(
		view: MarkdownView,
		affectedPaths?: ReadonlySet<string>,
	): void {
		if (!view.file) {
			return;
		}

		const sourcePath = view.file.path;
		if (affectedPaths && !affectedPaths.has(sourcePath)) {
			return;
		}

		if (view.getMode() === "source") {
			const cm = view.editor?.cm;
			if (cm) {
				cm.dispatch({
					effects: forceRedrawEffect.of(undefined),
				});
			}

			decorateLivePreviewPostProcessorContainers(view, sourcePath);
			return;
		}

		if (view.getMode() !== "preview") {
			return;
		}

		// 起動直後などで postProcessor 登録対象外だった既存プレビュー要素にも適用する
		const previewContainer = getPreviewContainerForReadingView(view);
		if (
			previewContainer &&
			previewContainer.isConnected &&
			!markdownRenderManager.isTrackedElement(sourcePath, previewContainer)
		) {
			stylingService.decorateLinksInContainer(previewContainer, sourcePath);
		}
	}

	function decorateLivePreviewPostProcessorContainers(
		view: MarkdownView,
		sourcePath: string,
	): void {
		if (view.getMode() !== "source") {
			return;
		}

		const containers = view.containerEl.querySelectorAll<HTMLElement>(
			".markdown-source-view .cm-preview-code-block, .markdown-source-view .cm-embed-block, .markdown-source-view .markdown-rendered",
		);

		containers.forEach((container) => {
			if (
				!container.isConnected ||
				markdownRenderManager.isTrackedElement(sourcePath, container)
			) {
				return;
			}
			stylingService.decorateLinksInContainer(container, sourcePath);
		});
	}

	function collectRefreshSourcePaths(
		affectedPaths: ReadonlySet<string>,
		affectedLookupKeys: ReadonlySet<string>,
	): Set<string> {
		const result = new Set<string>(affectedPaths);

		if (affectedLookupKeys.size === 0) {
			return result;
		}

		const sourcePaths =
			indexingService.getSourcePathsForLookupKeys(affectedLookupKeys);

		for (const sourcePath of sourcePaths) {
			result.add(sourcePath);
		}

		return result;
	}

	function updateCanvasView(
		canvasView: CanvasView,
		affectedPaths?: ReadonlySet<string>,
		affectedLookupKeys?: ReadonlySet<string>,
	): void {
		const canvasFile = canvasView.file;
		if (!canvasFile || !canvasView.canvas?.nodes) {
			return;
		}

		for (const node of canvasView.canvas.nodes.values()) {
			const anyNode = node as any;
			const sourcePath = anyNode.file?.path ?? canvasFile.path;
			const previewEl = anyNode.child?.previewMode?.containerEl;
			const targetEl = previewEl || anyNode.contentEl;

			const matchesPath = !affectedPaths || affectedPaths.has(sourcePath);
			const matchesLookupKey =
				!matchesPath &&
				!!affectedLookupKeys &&
				affectedLookupKeys.size > 0 &&
				!!targetEl &&
				containerHasAffectedLookupKey(targetEl, affectedLookupKeys);

			if (!matchesPath && !matchesLookupKey) {
				continue;
			}

			const cm = anyNode.child?.editMode?.cm;
			if (cm) {
				cm.dispatch({
					effects: forceRedrawEffect.of(undefined),
				});
				continue;
			}

			if (anyNode.file && anyNode.contentEl) {
				stylingService.decorateLinksInContainer(
					anyNode.contentEl,
					anyNode.file.path,
				);
				continue;
			}

			if (targetEl) {
				stylingService.decorateLinksInContainer(targetEl, canvasFile.path);
			}
		}
	}

	function containerHasAffectedLookupKey(
		container: HTMLElement,
		affectedLookupKeys: ReadonlySet<string>,
	): boolean {
		const links = container.querySelectorAll<HTMLElement>(".internal-link");

		for (const link of links) {
			const lookupKey = getInternalLinkLookupKey(link);
			if (lookupKey && affectedLookupKeys.has(lookupKey)) {
				return true;
			}
		}

		return false;
	}

	function reprocessTrackedMarkdownDecorations(sourcePaths: Iterable<string>): void {
		for (const sourcePath of sourcePaths) {
			markdownRenderManager.reprocessDecorations(sourcePath);
		}
	}

	function updateBasesPanes(affectedLookupKeys?: ReadonlySet<string>): void {
		if (affectedLookupKeys && affectedLookupKeys.size === 0) {
			return;
		}

		for (const ownerDocument of collectWorkspaceDocuments(app.workspace)) {
			const basesPanes =
				ownerDocument.querySelectorAll<HTMLElement>(".bases-view");
			basesPanes.forEach((pane) => {
				if (affectedLookupKeys) {
					const links = collectBasesLinksIfAffected(pane, affectedLookupKeys);
					if (links === null) return;
					processBasesPane(pane, stylingService, links);
				} else {
					processBasesPane(pane, stylingService);
				}
			});
		}
	}

	return {
		updateAllViews,
		updateForContext,
		updateActiveMarkdownViewDecorations,
	};
}

// --- File-scoped pure helpers ---

function getInternalLinkLookupKey(linkEl: HTMLElement): string | undefined {
	const href =
		linkEl.getAttribute("data-href") ||
		linkEl.getAttribute("href") ||
		linkEl.textContent?.trim();

	if (!href) {
		return undefined;
	}

	const normalizedPath = normalizeHrefToLookupPath(href);
	return toCaseInsensitiveLookupKey(normalizedPath);
}

function getPreviewContainerForReadingView(view: MarkdownView): HTMLElement | null {
	const previewMode = view.previewMode as
		| {
				containerEl?: HTMLElement;
		  }
		| undefined;
	if (isHTMLElementLike(previewMode?.containerEl)) {
		return previewMode.containerEl;
	}

	return view.containerEl.querySelector<HTMLElement>(
		".markdown-reading-view .markdown-preview-view",
	);
}

function collectBasesLinksIfAffected(
	pane: HTMLElement,
	affectedLookupKeys: ReadonlySet<string>,
): HTMLElement[] | null {
	const links = pane.querySelectorAll<HTMLElement>(".internal-link");

	for (let i = 0; i < links.length; i++) {
		const lookupKey = getBasesLinkLookupKey(links[i]);
		if (lookupKey && affectedLookupKeys.has(lookupKey)) {
			return Array.from(links);
		}
	}

	return null;
}
