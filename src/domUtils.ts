import { MarkdownView } from "obsidian";

export const CONTAINER_CLASS = "another-two-hop-links-container";

export function getContainerElements(markdownView: MarkdownView): Element[] {
	const scrollers = markdownView.containerEl.querySelectorAll(
		".markdown-preview-view, .markdown-source-view .cm-scroller"
	);

	const containers: Element[] = [];

	for (let i = 0; i < scrollers.length; i++) {
		containers.push(findOrCreateContainer(scrollers.item(i)));
	}

	return containers;
}

function findOrCreateContainer(parent: Element): Element {
	const existingContainer = parent.querySelector("." + CONTAINER_CLASS);
	if (existingContainer) {
		return existingContainer;
	}
	return parent.createDiv({ cls: CONTAINER_CLASS });
}
