import { MarkdownView } from "obsidian";
import { CONTAINER_CLASS } from "../../appConstants";

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

export function getContainerElements(markdownView: MarkdownView): Element[] {
	const scrollers = markdownView.containerEl.querySelectorAll(
		".view-content > .markdown-reading-view > .markdown-preview-view, .view-content > .markdown-source-view > .cm-editor > .cm-scroller",
	);

	const containers: Element[] = [];

	for (let i = 0; i < scrollers.length; i++) {
		containers.push(findOrCreateContainer(scrollers.item(i)));
	}

	return containers;
}

function findOrCreateContainer(parent: Element): Element {
	parent.classList.add("ccl-inline-card-host");

	const existingContainer = parent.querySelector("." + CONTAINER_CLASS);
	if (existingContainer) {
		return existingContainer;
	}

	return parent.createDiv({ cls: CONTAINER_CLASS });
}
