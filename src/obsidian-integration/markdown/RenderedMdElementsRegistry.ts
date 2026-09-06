import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { StylingService } from "obsidian-integration/link-decoration/stylingService";

/**
 * Track elements rendered by markdownPostProcessor
 * and provide efficient reprocessing when data updates.
 */
export class RenderedMdElementsRegistry {
	private readonly renderedElements = new Map<string, Set<HTMLElement>>();

	constructor(private readonly stylingService: StylingService) {}

	public registerElement(
		sourcePath: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): void {
		if (!this.renderedElements.has(sourcePath)) {
			this.renderedElements.set(sourcePath, new Set());
		}
		const elementsSet = this.renderedElements.get(sourcePath)!;
		elementsSet.add(el);

		// Hook into MarkdownRenderChild's lifecycle and remove the element from the Set when it is destroyed
		const renderChild = new MarkdownRenderChild(el);
		renderChild.onunload = () => {
			this.removeElement(sourcePath, elementsSet, el);
		};
		ctx.addChild(renderChild);
	}

	/**
	 * Reapply link decorations to all registered elements for the specified file.
	 * sourcePath - File path to reprocess
	 */
	public reprocessDecorations(sourcePath: string): void {
		const elements = this.renderedElements.get(sourcePath);
		if (!elements) {
			return;
		}

		for (const el of elements) {
			// Confirm that the element is still in the DOM
			if (!el.isConnected) {
				this.removeElement(sourcePath, elements, el);
				continue;
			}

			this.stylingService.decorateLinksInContainer(el, sourcePath);
		}
	}

	public isTrackedElement(sourcePath: string, el: HTMLElement): boolean {
		return this.renderedElements.get(sourcePath)?.has(el) ?? false;
	}

	public getTrackedSourcePaths(): Set<string> {
		return new Set(this.renderedElements.keys());
	}

	public destroy(): void {
		this.renderedElements.clear();
	}

	private removeElement(
		sourcePath: string,
		elementsSet: Set<HTMLElement>,
		el: HTMLElement,
	): void {
		elementsSet.delete(el);
		if (
			elementsSet.size === 0 &&
			this.renderedElements.get(sourcePath) === elementsSet
		) {
			this.renderedElements.delete(sourcePath);
		}
	}
}
