import type { CanvasViewCanvas } from "obsidian-typings";
import type { CanvasNodeData } from "types/obsidian";
import type {
	DisplayModeStrategy,
	DisplayModeStrategyContext,
} from "./DisplayModeStrategyContext";

export function createEditorInlineModeStrategy(
	context: DisplayModeStrategyContext,
): DisplayModeStrategy {
	return {
		activate(): void {
			context.detachSidebarView();
			context.mountInlineComponents(true);
		},

		deactivate(): void {
			context.unmountInlineComponents();
		},

		handleActiveLeafChange(): void {
			context.mountInlineComponents(false);
		},

		handleCanvasSelectionChange(
			_canvas: CanvasViewCanvas,
			_selectedNodes: CanvasNodeData[],
		): void {},
	};
}
