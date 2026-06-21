import type { CanvasViewCanvas } from "obsidian-typings";
import type { CanvasNodeData } from "types/obsidian";

export interface DisplayModeStrategy {
	activate(): void;
	deactivate(): void;
	handleActiveLeafChange(view: unknown): void;
	handleCanvasSelectionChange(
		canvas: CanvasViewCanvas,
		selectedNodes: CanvasNodeData[],
	): void;
}

export interface DisplayModeStrategyContext {
	ensureSidebarView(): Promise<void>;
	detachSidebarView(): void;
	clearSidebarViewContent(): void;
	mountInlineComponents(forceRemount: boolean): void;
	unmountInlineComponents(): void;
	updateSidebarForActiveFile(): void;
	updateSidebarForCanvasSelectionView(view: unknown): void;
	updateSidebarForCanvasSelectionEvent(
		canvas: CanvasViewCanvas,
		selectedNodes: CanvasNodeData[]
	): void;
	isCanvasSingleFileSelected(view: unknown): boolean;
	isMarkdownView(view: unknown): boolean;
	isCanvasView(view: unknown): boolean;
	isBaseView(view: unknown): boolean;
	isMediaOrPdfView(view: unknown): boolean;
}
