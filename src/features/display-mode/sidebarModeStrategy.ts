import type { CanvasViewCanvas } from "obsidian-typings";
import type { CanvasNodeData } from "types/obsidian";
import type {
	DisplayModeStrategy,
	DisplayModeStrategyContext,
} from "./DisplayModeStrategyContext";

export function createSidebarModeStrategy(
	context: DisplayModeStrategyContext,
): DisplayModeStrategy {
	return {
		activate(): void {
			context.unmountInlineComponents();
			context.ensureSidebarView().then(() => {
				context.updateSidebarForActiveFile();
			});
		},

		deactivate(): void {},

		handleActiveLeafChange(view: unknown): void {
			if (context.isCanvasSingleFileSelected(view)) {
				context.updateSidebarForCanvasSelectionView(view);
				return;
			}

			context.updateSidebarForActiveFile();
		},

		handleCanvasSelectionChange(
			canvas: CanvasViewCanvas,
			selectedNodes: CanvasNodeData[],
		): void {
			context.updateSidebarForCanvasSelectionEvent(canvas, selectedNodes);
		},
	};
}
