import type { CanvasViewCanvas } from "obsidian-typings";
import type { CanvasNodeData } from "types/obsidian";
import type {
	DisplayModeStrategy,
	DisplayModeStrategyContext,
} from "./DisplayModeStrategyContext";

export function createHybridModeStrategy(
	context: DisplayModeStrategyContext,
	getActiveView: () => unknown,
): DisplayModeStrategy {
	function applyLayout(view: unknown, forceInlineRemount: boolean): void {
		if (!view) {
			return;
		}

		if (context.isMarkdownView(view)) {
			context.clearSidebarViewContent();
			context.mountInlineComponents(forceInlineRemount);
			return;
		}

		if (context.isCanvasSingleFileSelected(view)) {
			context.updateSidebarForCanvasSelectionView(view);
			return;
		}

		if (
			context.isCanvasView(view) ||
			context.isBaseView(view) ||
			context.isMediaOrPdfView(view)
		) {
			context.updateSidebarForActiveFile();
			return;
		}
	}

	return {
		activate(): void {
			context.ensureSidebarView().then(() => {
				const activeView = getActiveView();
				applyLayout(activeView, true);
			});
		},

		deactivate(): void {},

		handleActiveLeafChange(view: unknown): void {
			applyLayout(view, false);
		},

		handleCanvasSelectionChange(
			canvas: CanvasViewCanvas,
			selectedNodes: CanvasNodeData[],
		): void {
			context.updateSidebarForCanvasSelectionEvent(canvas, selectedNodes);
		},
	};
}
