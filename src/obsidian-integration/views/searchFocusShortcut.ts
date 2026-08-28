import { SEARCH_INPUT_SELECTOR } from "cards/navigation/resultFocus";
import { querySelectorAllIncludingShadow } from "shared/ui/dom/shadowDom";
import type { Scope } from "obsidian";

/**
 * Registers Ctrl+F or Cmd+F in a view scope and focuses its card search input.
 * Returns a cleanup function that removes the keymap handler.
 */
export function registerSearchFocusShortcut(
	rootEl: HTMLElement,
	scope: Scope,
): () => void {
	const handler = scope.register(["Mod"], "f", () => {
		const searchInput = querySelectorAllIncludingShadow<HTMLElement>(
			rootEl,
			SEARCH_INPUT_SELECTOR,
		)[0];
		if (!searchInput) {
			return;
		}

		searchInput.focus();
		return false;
	});

	return () => scope.unregister(handler);
}
