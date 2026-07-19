import { MarkdownView } from "obsidian";
import { CONTAINER_CLASS } from "../../../appConstants";

export type InlineMarkdownSurface = "source" | "preview";

export interface ActiveInlineContainer {
	surface: InlineMarkdownSurface;
	container: HTMLElement;
}

const INLINE_PARENT_SELECTORS: Record<InlineMarkdownSurface, string> = {
	source: ".view-content > .markdown-source-view > .cm-editor > .cm-scroller",
	preview: ".view-content > .markdown-reading-view > .markdown-preview-view",
};

export function isElementVisible(element: HTMLElement): boolean {
	if (!element.isConnected) {
		return false;
	}

	if (element.getClientRects().length > 0) {
		return true;
	}

	if (element.offsetParent !== null) {
		return true;
	}

	const style = window.getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden";
}

export function getActiveInlineContainer(
	markdownView: MarkdownView,
): ActiveInlineContainer | null {
	const mode = markdownView.getMode();
	if (mode !== "source" && mode !== "preview") {
		return null;
	}

	const parent = markdownView.containerEl.querySelector<HTMLElement>(
		INLINE_PARENT_SELECTORS[mode],
	);
	if (!parent) {
		return null;
	}

	return {
		surface: mode,
		container: findOrCreateContainer(parent),
	};
}

function findOrCreateContainer(parent: HTMLElement): HTMLElement {
	parent.classList.add("ccl-inline-card-host");

	const existingContainer = parent.querySelector<HTMLElement>("." + CONTAINER_CLASS);
	if (existingContainer) {
		return existingContainer;
	}

	const container = parent.ownerDocument.createElement("div");
	container.classList.add(CONTAINER_CLASS);
	parent.append(container);
	return container;
}
