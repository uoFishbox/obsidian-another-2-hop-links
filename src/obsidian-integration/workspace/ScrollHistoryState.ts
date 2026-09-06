// --- START OF FILE core/managers/ScrollManager.ts ---
import { MarkdownView, type EditorPosition } from "obsidian";
import { CONTAINER_CLASS } from "shared/ui/dom/domUtils";

interface ScrollState {
	scrollTop: number;
	cursor?: EditorPosition;
}

export class ScrollManager {
	private history = new Map<string, ScrollState>();

	/**
	 * Clear the history for the specified Leaf.
	 * Called when switching files, etc.
	 */
	public clearHistory(leafId: string): void {
		this.history.delete(leafId);
	}

	/**
	 * Toggle the scroll position.
	 */
	public toggleScroll(view: MarkdownView): void {
		const leafId = view.leaf.id;
		const container = view.containerEl.querySelector(`.${CONTAINER_CLASS}`);

		// Do nothing if the container does not exist (for example, it is hidden by settings)
		if (!container) return;

		if (this.history.has(leafId)) {
			// --- When history exists: return to the previous position ---
			this.restorePosition(view, leafId);
		} else {
			// --- When no history exists: save the current position and scroll down ---
			this.saveAndScrollToContainer(view, leafId, container);
		}
	}

	private saveAndScrollToContainer(
		view: MarkdownView,
		leafId: string,
		container: Element,
	): void {
		const mode = view.getMode();
		let scrollTop = 0;
		let cursor: EditorPosition | undefined;

		// Get the current position
		if (mode === "source") {
			scrollTop = view.editor.getScrollInfo().top;
			cursor = view.editor.getCursor();
		} else {
			scrollTop = view.previewMode.getScroll();
		}

		// Save to history
		this.history.set(leafId, { scrollTop, cursor });

		// Scroll to the container
		container.scrollIntoView({ block: "start" });

		// Focus the search bar
		const searchInput = container.querySelector(
			".twohop-search-input",
		) as HTMLInputElement | null;
		if (searchInput) {
			searchInput.focus();
		}
	}

	private restorePosition(view: MarkdownView, leafId: string): void {
		const state = this.history.get(leafId);
		if (!state) return;

		const mode = view.getMode();

		if (mode === "source") {
			this.restoreSourceModePosition(view, state);
		} else {
			// Restore preview mode
			view.previewMode.applyScroll(state.scrollTop);
		}

		// Consume and remove the history
		this.history.delete(leafId);
	}

	private restoreSourceModePosition(view: MarkdownView, state: ScrollState): void {
		// Apply scrollTop last because setCursor/focus readjusts the scroll position
		view.editor.focus();
		if (state.cursor) {
			view.editor.setCursor(state.cursor);
		}

		const applySavedScrollTop = () => {
			view.editor.scrollTo(0, state.scrollTop);
		};

		// Apply once synchronously, then again on the next frame to prevent auto-scroll from overriding it
		applySavedScrollTop();
		const ownerWindow = view.containerEl.ownerDocument.defaultView;
		if (ownerWindow?.requestAnimationFrame) {
			ownerWindow.requestAnimationFrame(() => applySavedScrollTop());
			return;
		}

		ownerWindow?.setTimeout(() => applySavedScrollTop(), 0);
	}
}
