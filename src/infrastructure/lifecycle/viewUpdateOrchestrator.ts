import { MarkdownView } from "obsidian";
import type { App } from "obsidian";
import type { CanvasView } from "obsidian-typings";
import type { DataUpdateContext } from "core/indexing/index-service/IndexEvents";
import type { StylingService } from "features/link-decoration/stylingService";
import type { RenderedMdElementsRegistry } from "../markdown/RenderedMdElementsRegistry";
import type { PropertyWidgetStyler } from "../../features/link-decoration/propertyWidgetStyler";
import type { PluginHost } from "types/pluginHost";
import {
	getBasesLinkLookupKey,
	processBasesPane,
} from "infrastructure/markdown/markdownHandlers";
import {
	normalizeHrefToLookupPath,
	toCaseInsensitiveLookupKey,
} from "core/indexing/link-resolution/linkResolution";

export interface ViewUpdateOrchestrator {
	updateAllViews(): void;
	updateForContext(context?: DataUpdateContext): void;
	updateActiveMarkdownViewDecorations(): void;
}

export interface ViewUpdateOrchestratorDeps {
	app: App;
	plugin: PluginHost;
	stylingService: StylingService;
	markdownRenderManager: RenderedMdElementsRegistry;
	propertyStyleManager: PropertyWidgetStyler;
}

export function createViewUpdateOrchestrator(
	deps: ViewUpdateOrchestratorDeps,
): ViewUpdateOrchestrator {
	const { app, plugin, stylingService, markdownRenderManager, propertyStyleManager } =
		deps;

	function updateAllViews(): void {
		reprocessTrackedMarkdownDecorations(collectTrackedMarkdownSourcePaths());
		updateMarkdownSourceViews();
		updateMarkdownReadingViews();
		updateCanvasViews();
		updateBasesPanes();
		propertyStyleManager.updateAll();
	}

	function updateForContext(context?: DataUpdateContext): void {
		if (!context || context.affectsAll) {
			updateAllViews();
			return;
		}

		const affectedPaths = context.affectedPaths ?? [];
		const affectedLookupKeys = context.affectedLookupKeys ?? [];
		const affectedTags = context.affectedTags ?? [];

		const hasPathOrLookupImpact =
			affectedPaths.length > 0 || affectedLookupKeys.length > 0;

		const hasOnlyTagImpact = !hasPathOrLookupImpact && affectedTags.length > 0;

		if (hasOnlyTagImpact) {
			return;
		}

		if (affectedPaths.length === 0 && affectedLookupKeys.length === 0) {
			updateAllViews();
			return;
		}

		const affectedPathSet = new Set(affectedPaths);
		const affectedLookupKeySet = new Set(affectedLookupKeys);
		const refreshSourcePathSet = collectRefreshSourcePaths(
			affectedPathSet,
			affectedLookupKeySet,
		);

		for (const sourcePath of refreshSourcePathSet) {
			markdownRenderManager.reprocessDecorations(sourcePath);
		}

		updateMarkdownSourceViews(refreshSourcePathSet);
		updateMarkdownReadingViews(refreshSourcePathSet);
		updateCanvasViews(refreshSourcePathSet, affectedLookupKeySet);
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
					effects: plugin.forceRedrawEffect.of(undefined),
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

	function updateMarkdownSourceViews(affectedPaths?: Set<string>): void {
		app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) {
				return;
			}

			if (leaf.view.getMode() !== "source" || !leaf.view.file) {
				return;
			}

			const sourcePath = leaf.view.file.path;
			if (affectedPaths && !affectedPaths.has(sourcePath)) {
				return;
			}

			const cm = leaf.view.editor?.cm;
			if (cm) {
				cm.dispatch({
					effects: plugin.forceRedrawEffect.of(undefined),
				});
			}

			decorateLivePreviewPostProcessorContainers(leaf.view, sourcePath);
		});
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

	function updateMarkdownReadingViews(affectedPaths?: Set<string>): void {
		app.workspace.iterateAllLeaves((leaf) => {
			if (
				leaf.view instanceof MarkdownView &&
				leaf.view.getMode() === "preview" &&
				leaf.view.file
			) {
				const sourcePath = leaf.view.file.path;
				if (affectedPaths && !affectedPaths.has(sourcePath)) {
					return;
				}

				// 起動直後などで postProcessor 登録対象外だった既存プレビュー要素にも適用する
				const previewContainer = getPreviewContainerForReadingView(leaf.view);
				if (
					previewContainer &&
					previewContainer.isConnected &&
					!markdownRenderManager.isTrackedElement(
						sourcePath,
						previewContainer,
					)
				) {
					stylingService.decorateLinksInContainer(
						previewContainer,
						sourcePath,
					);
				}
			}
		});
	}

	function collectRefreshSourcePaths(
		affectedPaths: Set<string>,
		affectedLookupKeys: Set<string>,
	): Set<string> {
		const result = new Set<string>(affectedPaths);

		if (affectedLookupKeys.size === 0) {
			return result;
		}

		const indexingService = plugin.indexingService;
		if (!indexingService) {
			return result;
		}

		const sourcePaths =
			indexingService.getSourcePathsForLookupKeys(affectedLookupKeys);

		for (const sourcePath of sourcePaths) {
			result.add(sourcePath);
		}

		return result;
	}

	function updateCanvasViews(
		affectedPaths?: Set<string>,
		affectedLookupKeys?: Set<string>,
	): void {
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() !== "canvas") {
				return;
			}

			const canvasView = leaf.view as CanvasView;
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
						effects: plugin.forceRedrawEffect.of(undefined),
					});
					continue;
				}

				if (anyNode.file && anyNode.contentEl) {
					plugin.processUnresolvedLinksInElement(
						anyNode.contentEl,
						anyNode.file.path,
					);
					continue;
				}

				if (targetEl) {
					plugin.processUnresolvedLinksInElement(targetEl, canvasFile.path);
				}
			}
		});
	}

	function containerHasAffectedLookupKey(
		container: HTMLElement,
		affectedLookupKeys: Set<string>,
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

	function collectTrackedMarkdownSourcePaths(): Set<string> {
		const sourcePaths = new Set<string>();
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file) {
				sourcePaths.add(leaf.view.file.path);
			}
		});

		for (const sourcePath of markdownRenderManager.getTrackedSourcePaths()) {
			sourcePaths.add(sourcePath);
		}

		return sourcePaths;
	}

	function reprocessTrackedMarkdownDecorations(sourcePaths: Iterable<string>): void {
		for (const sourcePath of sourcePaths) {
			markdownRenderManager.reprocessDecorations(sourcePath);
		}
	}

	function updateBasesPanes(affectedLookupKeys?: Set<string>): void {
		if (affectedLookupKeys && affectedLookupKeys.size === 0) {
			return;
		}

		const basesPanes = document.querySelectorAll<HTMLElement>(".bases-view");
		basesPanes.forEach((pane) => {
			if (affectedLookupKeys) {
				const links = collectBasesLinksIfAffected(pane, affectedLookupKeys);
				if (links === null) return;
				processBasesPane(pane as HTMLElement, stylingService, links);
			} else {
				processBasesPane(pane as HTMLElement, stylingService);
			}
		});
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
	if (previewMode?.containerEl instanceof HTMLElement) {
		return previewMode.containerEl;
	}

	return view.containerEl.querySelector<HTMLElement>(
		".markdown-reading-view .markdown-preview-view",
	);
}

function collectBasesLinksIfAffected(
	pane: HTMLElement,
	affectedLookupKeys: Set<string>,
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
