import type { App, TFile, WorkspaceLeaf } from "obsidian";
import type {
	CanvasViewCanvas,
	GlobalSearchPluginInstance,
} from "obsidian-typings";
import type { CanvasNodeData } from "types/obsidian";

export type InternalCapability =
	| "page-preview:onLinkHover"
	| "global-search:openGlobalSearch"
	| "workspace-leaf:history"
	| "canvas:getSelectionData"
	| "canvas:createFileNode"
	| "property-widget:render-save";

export type CapabilityRisk = "low" | "medium" | "high";

export type CapabilityResult<T> =
	| { ok: true; value: T; risk: CapabilityRisk }
	| { ok: false; reason: string; risk: CapabilityRisk };

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
	onLinkHover: PagePreviewOnLinkHoverCapability["instance"]["onLinkHover"];
}

export interface GlobalSearchOpenCapability {
	instance: GlobalSearchPluginInstance & {
		openGlobalSearch: (query: string) => void;
	};
	openGlobalSearch: (query: string) => void;
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

export type CanvasWithSelectionData = Omit<
	CanvasViewCanvas,
	"getSelectionData"
> & {
	getSelectionData?: () => { nodes?: CanvasNodeData[] };
};

export interface CanvasWithFileNodeCreation extends CanvasViewCanvas {
	createFileNode: (options: {
		pos: unknown;
		file: TFile;
		position: "center" | string;
	}) => unknown;
}

export interface PropertyWidgetComponentLike {
	onunload?: () => void;
}

export interface PropertyWidgetLike {
	render: (...args: unknown[]) => PropertyWidgetComponentLike;
	save: (...args: unknown[]) => unknown;
}

export class ObsidianInternalFacade {
	constructor(private app: App) {}

	getPagePreviewOnLinkHover(): CapabilityResult<PagePreviewOnLinkHoverCapability> {
		const instance = this.getInternalPluginInstance("page-preview");
		if (!instance || !isRecord(instance)) {
			return {
				ok: false,
				reason: "page-preview instance unavailable",
				risk: "high",
			};
		}

		const onLinkHover = instance.onLinkHover;
		if (typeof onLinkHover !== "function") {
			return {
				ok: false,
				reason: "page-preview onLinkHover unavailable",
				risk: "high",
			};
		}

		return {
			ok: true,
			value: {
				instance: instance as PagePreviewOnLinkHoverCapability["instance"],
				onLinkHover:
					onLinkHover as PagePreviewOnLinkHoverCapability["onLinkHover"],
			},
			risk: "high",
		};
	}

	getGlobalSearchOpenGlobalSearch(): CapabilityResult<GlobalSearchOpenCapability> {
		const instance = this.getInternalPluginInstance("global-search");
		if (!instance || !isRecord(instance)) {
			return {
				ok: false,
				reason: "global-search instance unavailable",
				risk: "high",
			};
		}

		const openGlobalSearch = instance.openGlobalSearch;
		if (typeof openGlobalSearch !== "function") {
			return {
				ok: false,
				reason: "global-search openGlobalSearch unavailable",
				risk: "high",
			};
		}

		return {
			ok: true,
			value: {
				instance: instance as unknown as GlobalSearchOpenCapability["instance"],
				openGlobalSearch:
					openGlobalSearch as GlobalSearchOpenCapability["openGlobalSearch"],
			},
			risk: "high",
		};
	}

	getLeafHistory(
		leaf: WorkspaceLeaf,
	): CapabilityResult<{
		leaf: LeafWithInternalHistory;
		history: LeafHistoryInternal;
	}> {
		const leafWithHistory = leaf as LeafWithInternalHistory;
		if (!isLeafHistoryInternal(leafWithHistory.history)) {
			return {
				ok: false,
				reason: "workspace leaf history unavailable",
				risk: "high",
			};
		}

		return {
			ok: true,
			value: {
				leaf: leafWithHistory,
				history: leafWithHistory.history,
			},
			risk: "high",
		};
	}

	getCanvasSelectionData(
		canvas: CanvasViewCanvas,
	): CapabilityResult<CanvasWithSelectionData> {
		if (hasOptionalFunction(canvas, "getSelectionData")) {
			return {
				ok: true,
				value: canvas as unknown as CanvasWithSelectionData,
				risk: "medium",
			};
		}

		return {
			ok: false,
			reason: "canvas getSelectionData unavailable",
			risk: "medium",
		};
	}

	getCanvasCreateFileNode(
		canvas: CanvasViewCanvas,
	): CapabilityResult<CanvasWithFileNodeCreation> {
		if (hasRequiredFunction(canvas, "createFileNode")) {
			return { ok: true, value: canvas, risk: "medium" };
		}

		return {
			ok: false,
			reason: "canvas createFileNode unavailable",
			risk: "medium",
		};
	}

	getPropertyWidgetRenderSave(
		widget: unknown,
	): CapabilityResult<PropertyWidgetLike> {
		if (!isRecord(widget) || typeof widget.render !== "function") {
			return {
				ok: false,
				reason: "property widget render unavailable",
				risk: "medium",
			};
		}

		return {
			ok: true,
			value: widget as unknown as PropertyWidgetLike,
			risk: "medium",
		};
	}

	private getInternalPluginInstance(id: string): unknown {
		const appWithInternals = this.app as App & {
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

export function isCanvasWithSelectionData(
	value: unknown,
): value is CanvasWithSelectionData {
	return hasOptionalFunction(value, "getSelectionData");
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

	return view.metadataEditor.contentEl instanceof HTMLElement
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
	return isRecord(value) && (value[key] === undefined || typeof value[key] === "function");
}

function isTFileLike(value: unknown): boolean {
	return isRecord(value) && typeof value.path === "string";
}
