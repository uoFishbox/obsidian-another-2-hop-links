import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { StylingService } from "obsidian-integration/link-decoration/stylingService";

/**
 * markdownPostProcessorでレンダリングされた要素を追跡し、
 * データ更新時に効率的に再処理するためのマネージャー。
 */
export class RenderedMdElementsRegistry {
	private readonly renderedElements = new Map<string, Set<HTMLElement>>();

	constructor(private readonly stylingService: StylingService) {}

	/**
	 * レンダリングされた要素を追跡対象として登録する。
	 * Componentライフサイクルを利用して、要素がDOMから削除された際に自動で登録解除する。
	 * @param sourcePath - ファイルのパス
	 * @param el - レンダリングされたHTML要素
	 * @param ctx - MarkdownPostProcessorContext
	 */
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

		// MarkdownRenderChildのライフサイクルにフックして、要素が破棄されたらSetから削除
		const renderChild = new MarkdownRenderChild(el);
		renderChild.onunload = () => {
			this.removeElement(sourcePath, elementsSet, el);
		};
		ctx.addChild(renderChild);
	}

	/**
	 * 指定されたファイルのすべての登録済み要素に対して、リンク装飾を再適用する。
	 * @param sourcePath - 再処理するファイルのパス
	 */
	public reprocessDecorations(sourcePath: string): void {
		const elements = this.renderedElements.get(sourcePath);
		if (!elements) {
			return;
		}

		for (const el of elements) {
			// 要素がまだDOMに存在することを確認
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
