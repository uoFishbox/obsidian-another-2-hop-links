import type { DisplayMode } from "features/settings/model";
import type {
	DisplayModeStrategy,
	DisplayModeStrategyContext,
} from "./DisplayModeStrategyContext";
import { createEditorInlineModeStrategy } from "./editorInlineModeStrategy";
import { createHybridModeStrategy } from "./hybridModeStrategy";
import { createSidebarModeStrategy } from "./sidebarModeStrategy";

export type { DisplayModeStrategy } from "./DisplayModeStrategyContext";

export function createDisplayModeStrategy(
	mode: DisplayMode,
	context: DisplayModeStrategyContext,
	getActiveView: () => unknown,
): DisplayModeStrategy {
	switch (mode) {
		case "sidebar-view":
			return createSidebarModeStrategy(context);
		case "hybrid":
			return createHybridModeStrategy(context, getActiveView);
		case "editor-inline":
		default:
			return createEditorInlineModeStrategy(context);
	}
}
