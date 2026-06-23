import { MarkdownView } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import type { ScrollManager } from "infrastructure/workspace/ScrollHistoryState";
import type { KeyboardCardNavigator } from "features/keyboard-navigation/KeyboardCardNavigator";

export interface RegisterCommandsDeps {
	readonly scrollManager: ScrollManager;
	readonly keyboardCardNavigator: KeyboardCardNavigator;
}

/**
 * Registers user-invokable commands (scroll and keyboard navigation).
 * The benchmark command is registered separately via registerBenchmarkCommand.
 */
export function registerCommands(plugin: PluginHost, deps: RegisterCommandsDeps): void {
	plugin.addCommand({
		id: "toggle-scroll-to-two-hop-links",
		name: "Scroll to Two Hop Links and focus search",
		checkCallback: (checking: boolean) => {
			// MarkdownViewがアクティブかつ、UIが表示モード(editor-inline or hybrid)の場合のみ有効
			const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const isInlineMode =
				plugin.settings.displayMode === "editor-inline" ||
				plugin.settings.displayMode === "hybrid";

			if (activeView && isInlineMode) {
				if (!checking) {
					deps.scrollManager.toggleScroll(activeView);
				}
				return true;
			}
			return false;
		},
	});

	plugin.addCommand({
		id: "activate-card-keyboard-mode",
		name: "Activate keyboard card navigation",
		callback: () => {
			deps.keyboardCardNavigator.toggle();
		},
	});
}
