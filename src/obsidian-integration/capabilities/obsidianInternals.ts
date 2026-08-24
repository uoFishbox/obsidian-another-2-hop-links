import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type { CanvasViewCanvas, GlobalSearchPluginInstance } from "obsidian-typings";
import type { CanvasNodeData } from "obsidian-integration/hostContracts";
import { isHTMLElementLike } from "shared/ui/dom/realmSafeDom";

export interface PagePreviewOnLinkHoverCapability {
	instance: {
		onLinkHover: (
			parent: unknown,
			targetEl: HTMLElement | ShadowRoot | null,
			linkText: string,
			sourcePath: string,
			state?: unknown,
			...args: unknown[]
		) => unknown;
	};
}

interface GlobalSearchOpenCapability {
	instance: GlobalSearchPluginInstance & {
		openGlobalSearch: (query: string) => void;
	};
}

export interface NativeHistoryEntry {
	state?: unknown;
	[key: string]: unknown;
}

export interface LeafHistoryInternal {
	backHistory: NativeHistoryEntry[];
	forwardHistory: NativeHistoryEntry[];
	deserialize(payload: {
		backHistory: NativeHistoryEntry[];
		forwardHistory: NativeHistoryEntry[];
	}): void;
}

export type LeafWithInternalHistory = WorkspaceLeaf & {
	history?: unknown;
	trigger?: (name: string, ...data: unknown[]) => unknown;
};

type CanvasWithSelectionData = Omit<CanvasViewCanvas, "getSelectionData"> & {
	getSelectionData?: () => { nodes?: CanvasNodeData[] };
};

interface CanvasWithFileNodeCreation extends CanvasViewCanvas {
	createFileNode: (options: {
		pos: unknown;
		file: TFile;
		position: "center" | string;
	}) => unknown;
}

export interface PropertyWidgetComponentLike {
	onunload?: () => void;
}

interface PropertyWidgetLike {
	render: (...args: unknown[]) => PropertyWidgetComponentLike;
	save: (...args: unknown[]) => unknown;
}

export function getPagePreviewOnLinkHover(
	app: App,
): PagePreviewOnLinkHoverCapability | null {
	const instance = getInternalPluginInstance(app, "page-preview");
	if (!isRecord(instance)) {
		return null;
	}

	const onLinkHover = instance.onLinkHover;
	if (typeof onLinkHover !== "function") {
		return null;
	}

	return {
		instance: instance as PagePreviewOnLinkHoverCapability["instance"],
	};
}

export function getGlobalSearchOpenGlobalSearch(
	app: App,
): GlobalSearchOpenCapability | null {
	const instance = getInternalPluginInstance(app, "global-search");
	if (!isRecord(instance)) {
		return null;
	}

	const openGlobalSearch = instance.openGlobalSearch;
	if (typeof openGlobalSearch !== "function") {
		return null;
	}

	return {
		instance: instance as unknown as GlobalSearchOpenCapability["instance"],
	};
}

export function getCanvasSelectionData(
	canvas: CanvasViewCanvas,
): CanvasWithSelectionData | null {
	return hasOptionalFunction(canvas, "getSelectionData")
		? (canvas as unknown as CanvasWithSelectionData)
		: null;
}

export function getCanvasCreateFileNode(
	canvas: CanvasViewCanvas,
): CanvasWithFileNodeCreation | null {
	return hasRequiredFunction(canvas, "createFileNode")
		? (canvas as unknown as CanvasWithFileNodeCreation)
		: null;
}

export function getPropertyWidgetRenderSave(
	widget: unknown,
): PropertyWidgetLike | null {
	return isRecord(widget) && typeof widget.render === "function"
		? (widget as unknown as PropertyWidgetLike)
		: null;
}

export function isLeafHistoryInternal(
	history: unknown,
): history is LeafHistoryInternal {
	if (!isRecord(history)) {
		return false;
	}

	return (
		Array.isArray(history.backHistory) &&
		Array.isArray(history.forwardHistory) &&
		typeof history.deserialize === "function"
	);
}

export function getCanvasFile(canvas: CanvasViewCanvas): TFile | null {
	const view = (canvas as CanvasViewCanvas & { view?: unknown }).view;
	if (!isRecord(view)) {
		return null;
	}
	const file = view.file;
	return isTFileLike(file) ? (file as TFile) : null;
}

export function getFileNodePath(node: CanvasNodeData): string | null {
	return typeof node.file === "string" ? node.file : null;
}

export function getMetadataEditorContentEl(view: unknown): HTMLElement | null {
	if (!isRecord(view) || !isRecord(view.metadataEditor)) {
		return null;
	}

	return isHTMLElementLike(view.metadataEditor.contentEl)
		? view.metadataEditor.contentEl
		: null;
}

export function getViewFile(view: unknown): TFile | null {
	if (!isRecord(view)) {
		return null;
	}
	const file = view.file;
	return isTFileLike(file) ? (file as TFile) : null;
}

function getInternalPluginInstance(app: App, id: string): unknown {
	const appWithInternals = app as App & {
		internalPlugins?: {
			plugins?: Record<string, { instance?: unknown }>;
			getPluginById?: (id: string) => { instance?: unknown } | undefined;
		};
	};
	const internalPlugins = appWithInternals.internalPlugins;
	return (
		internalPlugins?.getPluginById?.(id)?.instance ??
		internalPlugins?.plugins?.[id]?.instance
	);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return !!value && typeof value === "object";
}

function hasRequiredFunction<K extends PropertyKey>(
	value: unknown,
	key: K,
): value is Record<K, (...args: unknown[]) => unknown> {
	return isRecord(value) && typeof value[key] === "function";
}

function hasOptionalFunction<K extends PropertyKey>(
	value: unknown,
	key: K,
): value is Record<K, (...args: unknown[]) => unknown> {
	return (
		isRecord(value) &&
		(value[key] === undefined || typeof value[key] === "function")
	);
}

function isTFileLike(value: unknown): boolean {
	return isRecord(value) && typeof value.path === "string";
}
