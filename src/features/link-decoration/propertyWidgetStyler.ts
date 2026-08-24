import type { App, TFile } from "obsidian";
import type { StylingService } from "features/link-decoration/stylingService";
import type { CanvasView } from "obsidian-typings";
import {
	getMetadataEditorContentEl,
	getViewFile,
} from "infrastructure/capabilities/obsidianInternals";

type RegisteredWidgetRecord = {
	sourceFile: TFile;
	path: string;
};

export interface PropertyWidgetStyler {
	register(el: HTMLElement, sourceFile: TFile): void;
	unregister(el: HTMLElement): void;
	pruneDisconnected(paths?: Iterable<string>): void;
	updateAll(): void;
	updateForPaths(paths: Iterable<string>): void;
	styleElement(el: HTMLElement, sourceFile: TFile): void;
	scanAndRegisterAll(app: App): void;
}

export function createPropertyWidgetStyler(
	stylingService: StylingService,
): PropertyWidgetStyler {
	const recordByElement = new Map<HTMLElement, RegisteredWidgetRecord>();
	const elementsByPath = new Map<string, Set<HTMLElement>>();

	function getOrCreateElementsForPath(path: string): Set<HTMLElement> {
		let elements = elementsByPath.get(path);
		if (!elements) {
			elements = new Set<HTMLElement>();
			elementsByPath.set(path, elements);
		}
		return elements;
	}

	function removeFromPathIndex(el: HTMLElement, path: string): void {
		const elements = elementsByPath.get(path);
		if (!elements) {
			return;
		}

		elements.delete(el);

		if (elements.size === 0) {
			elementsByPath.delete(path);
		}
	}

	function pruneDisconnected(paths?: Iterable<string>): void {
		const pathSet = paths ? (paths instanceof Set ? paths : new Set(paths)) : null;
		const affectedPaths = pathSet ? [...pathSet] : [...elementsByPath.keys()];

		for (const path of affectedPaths) {
			const elements = elementsByPath.get(path);
			if (!elements) {
				continue;
			}

			for (const el of elements) {
				if (!el.isConnected) {
					elements.delete(el);
					recordByElement.delete(el);
				}
			}

			if (elements.size === 0) {
				elementsByPath.delete(path);
			}
		}
	}

	function styleLiveWidgets(path: string): void {
		const elements = elementsByPath.get(path);
		if (!elements) {
			return;
		}

		for (const el of elements) {
			if (!el.isConnected) {
				continue;
			}
			const record = recordByElement.get(el);
			if (!record) {
				continue;
			}
			styleElement(el, record.sourceFile);
		}
	}

	function register(el: HTMLElement, sourceFile: TFile): void {
		const path = sourceFile.path;
		const existing = recordByElement.get(el);
		if (existing) {
			if (existing.path === path && existing.sourceFile === sourceFile) {
				return;
			}
			removeFromPathIndex(el, existing.path);
		}

		recordByElement.set(el, { sourceFile, path });
		getOrCreateElementsForPath(path).add(el);
	}

	function unregister(el: HTMLElement): void {
		const record = recordByElement.get(el);
		if (!record) {
			return;
		}

		recordByElement.delete(el);
		removeFromPathIndex(el, record.path);
	}

	function updateAll(): void {
		for (const path of elementsByPath.keys()) {
			styleLiveWidgets(path);
		}
	}

	function updateForPaths(paths: Iterable<string>): void {
		const affectedPathSet = paths instanceof Set ? paths : new Set(paths);
		if (affectedPathSet.size === 0) {
			return;
		}

		for (const path of affectedPathSet) {
			styleLiveWidgets(path);
		}
	}

	function styleElement(el: HTMLElement, sourceFile: TFile): void {
		stylingService.decoratePropertiesPane(el, sourceFile);
	}

	function registerAndStyleNewWidget(el: HTMLElement, file: TFile): boolean {
		if (recordByElement.has(el)) {
			return false;
		}

		register(el, file);
		styleElement(el, file);
		return true;
	}

	/**
	 * ロード時、Patcherがフックする前にレンダリングされた要素を捕捉する
	 */
	function scanAndRegisterAll(app: App): void {
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!view) return;

			const propertiesEl = getMetadataEditorContentEl(view);
			const file = getViewFile(view);
			if (propertiesEl && file) {
				registerAndStyleNewWidget(propertiesEl, file);
			}

			if (view.getViewType() === "canvas") {
				const canvasView = view as CanvasView;
				if (!canvasView.canvas?.nodes) return;

				const canvasNodesMap: Map<string, { file?: TFile }> =
					canvasView.canvas.nodes;
				const nodeElements =
					canvasView.containerEl.querySelectorAll<HTMLElement>(
						".canvas-node",
					);
				for (const nodeEl of nodeElements) {
					const nodeId = nodeEl.dataset.nodeId;
					if (!nodeId) continue;

					const nodeData = canvasNodesMap.get(nodeId);
					if (!nodeData || !nodeData.file) continue;

					const file = nodeData.file;
					const propertiesEl =
						nodeEl.querySelector<HTMLElement>(".metadata-container");

					if (propertiesEl) {
						registerAndStyleNewWidget(propertiesEl, file);
					}
				}
			}
		});
	}

	return {
		register,
		unregister,
		pruneDisconnected,
		updateAll,
		updateForPaths,
		styleElement,
		scanAndRegisterAll,
	};
}
