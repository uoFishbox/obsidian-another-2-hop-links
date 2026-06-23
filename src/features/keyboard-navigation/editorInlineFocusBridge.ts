import { Prec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { SEARCH_INPUT_SELECTOR } from "./resultFocus";
import type { PluginHost } from "types/pluginHost";

const INLINE_SURFACE_SELECTOR =
	'.cosense-card-links__root[data-ccl-card-surface="inline"]';

type VisibleElement = HTMLElement & {
	isConnected: boolean;
	getClientRects(): DOMRectList;
};

function isVisible(element: HTMLElement | null): element is VisibleElement {
	if (!element || !element.isConnected) {
		return false;
	}

	if (element.getClientRects().length > 0) {
		return true;
	}

	const style = window.getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden";
}

function focusInlineSearchInputFromEditor(
	view: EditorView,
	isEnabled: () => boolean,
): boolean {
	if (!isEnabled()) {
		return false;
	}

	const root =
		view.dom.querySelector<HTMLElement>(INLINE_SURFACE_SELECTOR) ??
		view.dom
			.closest(".markdown-source-view")
			?.querySelector<HTMLElement>(INLINE_SURFACE_SELECTOR) ??
		null;

	if (!isVisible(root)) {
		return false;
	}

	const input = root.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
	if (!isVisible(input)) {
		return false;
	}

	const selection = view.state.selection.main;
	if (!selection.empty) {
		return false;
	}

	const currentLine = view.state.doc.lineAt(selection.head).number;
	const lastLine = view.state.doc.lines;
	if (currentLine !== lastLine) {
		return false;
	}

	input.focus({ preventScroll: true });
	return true;
}

export function buildEditorInlineFocusBridgeExtension(plugin: PluginHost) {
	return Prec.highest(
		keymap.of([
			{
				key: "ArrowDown",
				run(view) {
					return focusInlineSearchInputFromEditor(
						view,
						() => plugin.settings.enableEditorArrowDownToSearchInput,
					);
				},
			},
		]),
	);
}

export { focusInlineSearchInputFromEditor };
