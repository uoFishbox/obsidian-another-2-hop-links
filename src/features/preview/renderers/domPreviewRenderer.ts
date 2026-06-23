import { MarkdownRenderer, type App } from "obsidian";
import type { PreviewData, PreviewDomRenderer } from "../public-types";

interface MarkdownDomPreviewOptions {
	fallbackHtml?: string;
	onError?: (error: unknown) => void;
}

function applyFallback(container: HTMLElement, fallbackHtml: string | undefined): void {
	container.replaceChildren();
	if (fallbackHtml?.trim()) {
		container.innerHTML = fallbackHtml;
	}
}

export function createMarkdownDomRenderer(
	app: App,
	sourcePath: string,
	markdown: string,
	options?: MarkdownDomPreviewOptions,
): PreviewDomRenderer {
	return async (container, component, signal) => {
		if (signal?.aborted) {
			return;
		}

		container.replaceChildren();

		try {
			await MarkdownRenderer.render(
				app,
				markdown,
				container,
				sourcePath,
				component,
			);

			if (signal?.aborted) {
				container.replaceChildren();
				return;
			}

			if (!container.innerHTML.trim()) {
				applyFallback(container, options?.fallbackHtml);
			}
		} catch (error) {
			if (signal?.aborted) {
				return;
			}

			options?.onError?.(error);
			applyFallback(container, options?.fallbackHtml);
		}
	};
}

export function createMarkdownDomPreview(
	app: App,
	sourcePath: string,
	markdown: string,
	options?: MarkdownDomPreviewOptions,
): PreviewData {
	return {
		type: "dom",
		render: createMarkdownDomRenderer(app, sourcePath, markdown, options),
	};
}
