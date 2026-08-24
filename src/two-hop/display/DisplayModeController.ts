import { MarkdownView, TFile, type Plugin, type App } from "obsidian";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type { CanvasViewCanvas } from "obsidian-typings";
import type { CanvasNodeData } from "obsidian-integration/hostContracts";
import type { SettingsManager } from "settings/persistence/SettingsManager";
import type { DisplayMode } from "settings/model";
import type { IComponentManager } from "obsidian-integration/lifecycle/ComponentController";
import { resolveWorkspaceWindow } from "obsidian-integration/workspace/workspaceDocuments";
import { TwoHopLinksView, TWO_HOP_LINKS_VIEW_TYPE } from "two-hop/ui/TwoHopLinksView";
import {
	getCanvasFile,
	getCanvasSelectionData,
	getFileNodePath,
} from "obsidian-integration/capabilities/obsidianInternals";

export class DisplayModeController {
	private readonly VIEW_TYPES = {
		CANVAS: "canvas",
		AUDIO: "audio",
		PDF: "pdf",
		IMAGE: "image",
		VIDEO: "video",
	} as const;

	private readonly NODE_TYPES = {
		FILE: "file",
	} as const;

	private activeMode: DisplayMode;

	constructor(
		private app: App,
		private settingsManager: SettingsManager,
		private componentManager: IComponentManager,
		private plugin: Plugin,
		private updateSidebarView?: (file: TFile) => void,
		private getActiveFile?: () => TFile | null,
	) {
		this.activeMode = this.settingsManager.settings.displayMode;

		this.plugin.registerEvent(
			this.app.workspace.on(
				"cosense-card-links:canvas-selection-changed" as never,
				this.handleCanvasSelectionChange.bind(this) as never,
			),
		);
	}

	public destroy(): void {
		this.deactivateMode(this.activeMode);
		this.deactivateInlineMode();
		this.deactivateSidebarView();
	}

	private handleCanvasSelectionChange(
		canvas: CanvasViewCanvas,
		selectedNodes: CanvasNodeData[],
	): void {
		if (this.activeMode === "editor-inline") {
			return;
		}

		this.updateSidebarForCanvasSelectionEvent(canvas, selectedNodes);
	}

	public mountInlineComponents(options: { forceRemount?: boolean } = {}): void {
		if (
			!["editor-inline", "hybrid"].includes(
				this.settingsManager.settings.displayMode,
			)
		) {
			return;
		}

		const skipIfMounted = !options.forceRemount;
		this.forEachMarkdownView((view, file) => {
			this.componentManager.mountComponentsForView(view, file, {
				skipIfMounted,
			});
		});
	}

	public reconcileInlineComponents(): void {
		this.mountInlineComponents({ forceRemount: false });
	}

	public handleSettingsChange(): void {
		this.deactivateMode(this.activeMode);
		this.activeMode = this.settingsManager.settings.displayMode;
		this.activateMode(this.activeMode);
		// 設定変更直後にも現在のアクティブビューに対する表示対象を再評価する
		this.handleActiveLeafChangeByMode(
			this.activeMode,
			this.app.workspace.activeLeaf?.view,
		);
	}

	public handleActiveLeafChange(): void {
		// アクティブリーフがサイドバー自体の場合は何もしない
		if (this.app.workspace.activeLeaf?.view instanceof TwoHopLinksView) {
			return;
		}

		this.handleActiveLeafChangeByMode(
			this.activeMode,
			this.app.workspace.activeLeaf?.view,
		);
	}

	private activateMode(mode: DisplayMode): void {
		switch (mode) {
			case "editor-inline":
				this.deactivateSidebarView();
				this.mountInlineComponents({ forceRemount: true });
				return;
			case "sidebar-view":
				this.deactivateInlineMode();
				void this.activateSidebarView().then(() => {
					this.updateSidebarForActiveFile();
				});
				return;
			case "hybrid":
				void this.activateSidebarView().then(() => {
					this.applyHybridLayout(this.app.workspace.activeLeaf?.view, true);
				});
		}
	}

	private deactivateMode(mode: DisplayMode): void {
		if (mode === "editor-inline") {
			this.deactivateInlineMode();
		}
	}

	private handleActiveLeafChangeByMode(mode: DisplayMode, view: unknown): void {
		switch (mode) {
			case "editor-inline":
				this.mountInlineComponents({ forceRemount: false });
				return;
			case "sidebar-view":
				if (this.isCanvasSingleFileSelected(view)) {
					this.updateSidebarForCanvasSelectionView(view);
					return;
				}
				this.updateSidebarForActiveFile();
				return;
			case "hybrid":
				this.applyHybridLayout(view, false);
		}
	}

	private applyHybridLayout(view: unknown, forceInlineRemount: boolean): void {
		if (!view) {
			return;
		}

		if (this.isMarkdownView(view)) {
			this.clearSidebarViewContent();
			this.mountInlineComponents({ forceRemount: forceInlineRemount });
			return;
		}

		if (this.isCanvasSingleFileSelected(view)) {
			this.updateSidebarForCanvasSelectionView(view);
			return;
		}

		if (
			this.isCanvasView(view) ||
			this.isBaseView(view) ||
			this.isMediaOrPdfView(view)
		) {
			this.updateSidebarForActiveFile();
		}
	}

	private async activateSidebarView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TWO_HOP_LINKS_VIEW_TYPE);
		if (existing.length > 0) return;

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf !== null) {
			await leaf.setViewState({
				type: TWO_HOP_LINKS_VIEW_TYPE,
				active: false, // フォーカスは奪わない
			});
		}
	}

	private deactivateSidebarView(): void {
		this.app.workspace.detachLeavesOfType(TWO_HOP_LINKS_VIEW_TYPE);
	}

	private clearSidebarViewContent(): void {
		const leaves = this.app.workspace.getLeavesOfType(TWO_HOP_LINKS_VIEW_TYPE);
		leaves.forEach((leaf) => {
			if (leaf.view instanceof TwoHopLinksView) {
				leaf.view.clearContent();
			}
		});
	}

	private forEachMarkdownView(
		callback: (view: MarkdownView, file: TFile) => void,
	): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) {
				callback(view, view.file);
			}
		}
	}

	private updateSidebarForCanvasSelectionView(view: unknown): void {
		const canvas = (view as { canvas?: CanvasViewCanvas })?.canvas;
		if (!canvas) return;

		if (this.shouldFollowSelectedCanvasFileNode()) {
			const canvasWithSelectionData = getCanvasSelectionData(canvas);
			const nodes: CanvasNodeData[] =
				canvasWithSelectionData?.getSelectionData?.()?.nodes ?? [];

			if (nodes.length === 1 && nodes[0].type === this.NODE_TYPES.FILE) {
				const node = nodes[0];
				const filePath = getFileNodePath(node);

				if (filePath && this.updateSidebarView) {
					const file = resolveFileByPath(this.app.vault, filePath);
					if (file) {
						this.updateSidebarView(file);
						return;
					}
				}
			}
		}

		this.updateSidebarWithCanvasFile(canvas);
	}

	private updateSidebarForCanvasSelectionEvent(
		canvas: CanvasViewCanvas,
		selectedNodes: CanvasNodeData[],
	): void {
		if (
			this.shouldFollowSelectedCanvasFileNode() &&
			selectedNodes.length === 1 &&
			selectedNodes[0].type === this.NODE_TYPES.FILE
		) {
			const node = selectedNodes[0];
			const filePath = getFileNodePath(node);

			if (filePath) {
				const file = resolveFileByPath(this.app.vault, filePath);
				if (file && this.updateSidebarView) {
					this.updateSidebarView(file);
				}
			}
		} else {
			const canvasFile = getCanvasFile(canvas);
			if (canvasFile && this.updateSidebarView) {
				this.updateSidebarView(canvasFile);
			}
		}
	}

	private updateSidebarWithCanvasFile(canvas: CanvasViewCanvas): boolean {
		const canvasFile = getCanvasFile(canvas);
		if (canvasFile && this.updateSidebarView) {
			this.updateSidebarView(canvasFile);
			return true;
		}
		return false;
	}

	private updateSidebarForActiveFile(): void {
		const activeFile = this.getActiveFile?.();
		if (activeFile && this.updateSidebarView) {
			const capturedPath = activeFile.path;
			const ownerWindow = resolveWorkspaceWindow(this.app.workspace);
			const update = () => {
				const latestActiveFile = this.getActiveFile?.();
				if (!latestActiveFile || latestActiveFile.path !== capturedPath) {
					return;
				}
				this.updateSidebarView?.(latestActiveFile);
			};

			if (ownerWindow?.requestAnimationFrame) {
				ownerWindow.requestAnimationFrame(update);
			} else {
				update();
			}
		}
	}

	private isCanvasSingleFileSelected(view: unknown): boolean {
		if (
			!view ||
			typeof (view as { getViewType?: () => string }).getViewType !== "function"
		) {
			return false;
		}

		if (
			(view as { getViewType: () => string }).getViewType() !==
			this.VIEW_TYPES.CANVAS
		) {
			return false;
		}

		const canvas = (view as { canvas?: CanvasViewCanvas }).canvas;
		if (!canvas) return false;

		const canvasWithSelectionData = getCanvasSelectionData(canvas);
		const nodes: CanvasNodeData[] =
			canvasWithSelectionData?.getSelectionData?.()?.nodes ?? [];

		return nodes.length === 1 && nodes[0].type === this.NODE_TYPES.FILE;
	}

	private shouldFollowSelectedCanvasFileNode(): boolean {
		return (
			this.settingsManager.settings.showTwoHopForSelectedCanvasFileNode ?? true
		);
	}

	private isMarkdownView(view: unknown): boolean {
		return view instanceof MarkdownView;
	}

	private isCanvasView(view: unknown): boolean {
		if (
			!view ||
			typeof (view as { getViewType?: () => string }).getViewType !== "function"
		) {
			return false;
		}

		return (
			(view as { getViewType: () => string }).getViewType() ===
			this.VIEW_TYPES.CANVAS
		);
	}

	private isBaseView(view: unknown): boolean {
		if (
			!view ||
			typeof (view as { getViewType?: () => string }).getViewType !== "function"
		) {
			return false;
		}

		return (view as { getViewType: () => string }).getViewType() === "bases";
	}

	private isMediaOrPdfView(view: unknown): boolean {
		if (
			!view ||
			typeof (view as { getViewType?: () => string }).getViewType !== "function"
		) {
			return false;
		}

		const viewType = (view as { getViewType: () => string }).getViewType();
		return (
			viewType === this.VIEW_TYPES.AUDIO ||
			viewType === this.VIEW_TYPES.PDF ||
			viewType === this.VIEW_TYPES.IMAGE ||
			viewType === this.VIEW_TYPES.VIDEO
		);
	}

	private deactivateInlineMode(): void {
		this.forEachMarkdownView((view) => {
			this.componentManager.unmountViewComponents(view);
		});
	}
}
