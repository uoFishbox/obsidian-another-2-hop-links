import type { App, TFile } from "obsidian";
import type { StylingService } from "features/link-decoration/stylingService";
import type { CanvasView } from "obsidian-typings";
import { enableLogging, logger } from "utils/logger";
import {
	getMetadataEditorContentEl,
	getViewFile,
} from "infrastructure/capabilities/ObsidianInternalFacade";

type RegisteredWidgetRecord = {
	sourceFile: TFile;
	path: string;
};

type WidgetRef = WeakRef<HTMLElement>;

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
	const activeWidgets = new WeakMap<HTMLElement, RegisteredWidgetRecord>();
	const widgetsByPath = new Map<string, Set<WidgetRef>>();

	function getOrCreateWidgetsForPath(path: string): Set<WidgetRef> {
		let widgets = widgetsByPath.get(path);
		if (!widgets) {
			widgets = new Set<WidgetRef>();
			widgetsByPath.set(path, widgets);
		}
		return widgets;
	}

	function removeFromPathIndex(el: HTMLElement, path: string): void {
		const widgets = widgetsByPath.get(path);
		if (!widgets) {
			return;
		}

		for (const ref of widgets) {
			const widget = ref.deref();
			if (!widget || widget === el) {
				widgets.delete(ref);
			}
		}

		if (widgets.size === 0) {
			widgetsByPath.delete(path);
		}
	}

	function compactPath(path: string): void {
		const widgets = widgetsByPath.get(path);
		if (!widgets) {
			return;
		}

		for (const ref of widgets) {
			const widget = ref.deref();
			if (!widget || !widget.isConnected) {
				widgets.delete(ref);
			}
		}

		if (widgets.size === 0) {
			widgetsByPath.delete(path);
		}
	}

	function styleLiveWidgets(path: string): void {
		const widgets = widgetsByPath.get(path);
		if (!widgets) {
			return;
		}

		for (const ref of widgets) {
			const el = ref.deref();
			if (!el || !el.isConnected) {
				widgets.delete(ref);
				continue;
			}

			const record = activeWidgets.get(el);
			if (!record) {
				continue;
			}
			styleElement(el, record.sourceFile);
		}

		if (widgets.size === 0) {
			widgetsByPath.delete(path);
		}
	}

	function register(el: HTMLElement, sourceFile: TFile): void {
		const path = sourceFile.path;
		const existing = activeWidgets.get(el);
		if (existing) {
			if (existing.path === path && existing.sourceFile === sourceFile) {
				return;
			}
			removeFromPathIndex(el, existing.path);
		}

		activeWidgets.set(el, { sourceFile, path });
		getOrCreateWidgetsForPath(path).add(new WeakRef(el));
	}

	function unregister(el: HTMLElement): void {
		const record = activeWidgets.get(el);
		if (!record) {
			return;
		}

		activeWidgets.delete(el);
		removeFromPathIndex(el, record.path);
	}

	function pruneDisconnected(paths?: Iterable<string>): void {
		if (!paths) {
			for (const path of widgetsByPath.keys()) {
				compactPath(path);
			}
			return;
		}

		const pathSet = paths instanceof Set ? paths : new Set(paths);
		for (const path of pathSet) {
			compactPath(path);
		}
	}

	function updateAll(): void {
		for (const path of widgetsByPath.keys()) {
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
		if (activeWidgets.has(el)) {
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
		if (enableLogging)
			logger(
				"[PropertyWidgetStyler] Scanning for existing property widgets across all views...",
			);
		let count = 0;

		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!view) return;

			const propertiesEl = getMetadataEditorContentEl(view);
			const file = getViewFile(view);
			if (propertiesEl && file && registerAndStyleNewWidget(propertiesEl, file)) {
				count++;
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

					if (propertiesEl && registerAndStyleNewWidget(propertiesEl, file)) {
						count++;
					}
				}
			}
		});

		if (count > 0 && enableLogging) {
			logger(
				`[PropertyWidgetStyler] Registered and styled ${count} existing property widgets.`,
			);
		}
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
