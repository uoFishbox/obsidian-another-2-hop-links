import type { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { StylingService } from "features/link-decoration/stylingService";
import type { RenderedMdElementsRegistry } from "infrastructure/markdown/RenderedMdElementsRegistry";
import {
	normalizeHrefToLookupPath,
	toCaseInsensitiveLookupKey,
} from "core/indexing/link-resolution/linkResolution";
import { UNRESOLVED_LINK_ATTRIBUTE } from "../../appConstants";
import { enableLogging, logger } from "shared/logging/logger";

export async function markdownPostProcessor(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	app: App,
	indexingService: IndexingService,
	stylingService: StylingService,
	markdownRenderManager: RenderedMdElementsRegistry,
): Promise<void> {
	markdownRenderManager.registerElement(ctx.sourcePath, el, ctx);

	if (enableLogging) {
		const renderedText = el.innerText;
		logger(`[Cosense card links] Post-processing markdown for: ${ctx.sourcePath}`, {
			text: renderedText,
		});
	}
	await indexingService.awaitIdle();

	stylingService.decorateLinksInContainer(el, ctx.sourcePath);
}

// ============================================================================
// Bases view processing
// ============================================================================

/**
 * Custom href extractor for Bases view
 * Bases view links have href attributes on parent elements
 */
export const basesHrefExtractor = (el: HTMLElement): string | undefined => {
	const attrNames = [
		"data-href",
		"href",
		"data-path",
		"data-file",
		"data-file-path",
	] as const;

	const candidates = [
		el,
		el.parentElement,
		el.closest<HTMLElement>(
			"[data-href], [href], [data-path], [data-file], [data-file-path]",
		),
	];

	for (const candidate of candidates) {
		if (!candidate) continue;
		for (const attrName of attrNames) {
			const value = candidate.getAttribute(attrName)?.trim();
			if (value) {
				return value;
			}
		}
	}

	const text = el.textContent?.trim();
	return text || undefined;
};

export function getBasesLinkLookupKey(linkEl: HTMLElement): string | undefined {
	const href = basesHrefExtractor(linkEl);
	if (!href) {
		return undefined;
	}

	const lookupPath = normalizeHrefToLookupPath(href);
	if (!lookupPath) {
		return undefined;
	}

	return toCaseInsensitiveLookupKey(lookupPath);
}

export function processBasesPane(
	basesEl: HTMLElement,
	stylingService: StylingService,
	precomputedLinks?: HTMLElement[],
): void {
	if (!stylingService.isDecorationEnabled()) {
		stylingService.clearAttributeFromContainer(
			basesEl,
			UNRESOLVED_LINK_ATTRIBUTE.NAME,
		);
		return;
	}

	const linkElements =
		precomputedLinks ??
		Array.from(basesEl.querySelectorAll<HTMLElement>(".internal-link"));

	if (linkElements.length === 0) {
		stylingService.clearAttributeFromContainer(
			basesEl,
			UNRESOLVED_LINK_ATTRIBUTE.NAME,
		);
		return;
	}

	stylingService.decorateLinkElementsInContainer(
		basesEl,
		linkElements,
		undefined,
		[],
		basesHrefExtractor,
		"bases",
	);
}
