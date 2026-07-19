import { MarkdownView, TFile, type Plugin, type App } from "obsidian";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import type { CanvasViewCanvas } from "obsidian-typings";
import type { CanvasNodeData } from "types/obsidian";
import type { SettingsManager } from "features/settings/persistence/SettingsManager";
import type { IComponentManager } from "types/services";
import type { WorkspaceViewQueries } from "infrastructure/workspace/workspaceViewQueries";
import type { DisplayModeStrategy } from "features/display-mode/createDisplayModeStrategy";
import type { DisplayModeStrategyContext } from "features/display-mode/DisplayModeStrategyContext";
import { createDisplayModeStrategy } from "features/display-mode/createDisplayModeStrategy";
import {
	TwoHopLinksView,
	TWO_HOP_LINKS_VIEW_TYPE,
} from "features/two-hop/ui/TwoHopLinksView";
import {
	getCanvasFile,
	getFileNodePath,
	ObsidianInternalFacade,
} from "infrastructure/capabilities/ObsidianInternalFacade";

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

	private currentStrategy: DisplayModeStrategy;
	private readonly strategyContext: DisplayModeStrategyContext;

	constructor(
		private app: App,
		private settingsManager: SettingsManager,
		private viewManager: WorkspaceViewQueries,
		private componentManager: IComponentManager,
		private plugin: Plugin,
		private updateSidebarView?: (file: TFile) => void,
		private getActiveFile?: () => TFile | null,
	) {
		this.strategyContext = {
			ensureSidebarView: () => this.activateSidebarView(),
			detachSidebarView: () => this.deactivateSidebarView(),
			clearSidebarViewContent: () => this.clearSidebarViewContent(),
			mountInlineComponents: (forceRemount) =>
				this.mountInlineComponents({ forceRemount }),
			unmountInlineComponents: () => this.deactivateInlineMode(),
			updateSidebarForActiveFile: () => this.updateSidebarForActiveFile(),
			updateSidebarForCanvasSelectionView: (view) =>
				this.updateSidebarForCanvasSelectionView(view),
			updateSidebarForCanvasSelectionEvent: (canvas, selectedNodes) =>
				this.updateSidebarForCanvasSelectionEvent(canvas, selectedNodes),
			isCanvasSingleFileSelected: (view) => this.isCanvasSingleFileSelected(view),
			isMarkdownView: (view) => this.isMarkdownView(view),
			isCanvasView: (view) => this.isCanvasView(view),
			isBaseView: (view) => this.isBaseView(view),
			isMediaOrPdfView: (view) => this.isMediaOrPdfView(view),
		};

		this.currentStrategy = createDisplayModeStrategy(
			this.settingsManager.settings.displayMode,
			this.strategyContext,
			() => this.app.workspace.activeLeaf?.view,
		);

		this.plugin.registerEvent(
			this.app.workspace.on(
				"cosense-card-links:canvas-selection-changed" as never,
				this.handleCanvasSelectionChange.bind(this) as never,
			),
		);
	}

	public destroy(): void {
		this.currentStrategy.deactivate();
		this.deactivateInlineMode();
		this.deactivateSidebarView();
	}

	private handleCanvasSelectionChange(
		canvas: CanvasViewCanvas,
		selectedNodes: CanvasNodeData[],
	): void {
		this.currentStrategy.handleCanvasSelectionChange(canvas, selectedNodes);
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
		this.currentStrategy.deactivate();
		this.currentStrategy = createDisplayModeStrategy(
			this.settingsManager.settings.displayMode,
			this.strategyContext,
			() => this.app.workspace.activeLeaf?.view,
		);
		this.currentStrategy.activate();
		// 設定変更直後にも現在のアクティブビューに対する表示対象を再評価する
		this.currentStrategy.handleActiveLeafChange(
			this.app.workspace.activeLeaf?.view,
		);
	}

	public handleActiveLeafChange(): void {
		// アクティブリーフがサイドバー自体の場合は何もしない
		if (this.app.workspace.activeLeaf?.view instanceof TwoHopLinksView) {
			return;
		}

		this.currentStrategy.handleActiveLeafChange(
			this.app.workspace.activeLeaf?.view,
		);
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
		for (const view of this.viewManager.getOpenMarkdownViews()) {
			const file = this.viewManager.getFileFromView(view);
			if (file && view instanceof MarkdownView) {
				callback(view, file);
			}
		}
	}

	private updateSidebarForCanvasSelectionView(view: unknown): void {
		const canvas = (view as { canvas?: CanvasViewCanvas })?.canvas;
		if (!canvas) return;

		if (this.shouldFollowSelectedCanvasFileNode()) {
			const capability = new ObsidianInternalFacade(
				this.app,
			).getCanvasSelectionData(canvas);
			const nodes: CanvasNodeData[] = capability.ok
				? (capability.value.getSelectionData?.()?.nodes ?? [])
				: [];

			if (nodes.length === 1 && nodes[0].type === this.NODE_TYPES.FILE) {
				const node = nodes[0];
				const filePath = getFileNodePath(node);

				if (filePath && this.updateSidebarView) {
					// ファイルパスからTFileを取得して表示更新
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
			requestAnimationFrame(() => {
				// rAF待機中にアクティブファイルが変わった場合は旧ファイル描画を抑止
				const latestActiveFile = this.getActiveFile?.();
				if (!latestActiveFile || latestActiveFile.path !== capturedPath) {
					return;
				}
				if (this.updateSidebarView) {
					this.updateSidebarView(latestActiveFile);
				}
			});
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

		const capability = new ObsidianInternalFacade(this.app).getCanvasSelectionData(
			canvas,
		);
		const nodes: CanvasNodeData[] = capability.ok
			? (capability.value.getSelectionData?.()?.nodes ?? [])
			: [];

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
