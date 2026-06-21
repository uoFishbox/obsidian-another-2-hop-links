import type { App } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import { markdownPostProcessor } from "infrastructure/markdown/markdownHandlers";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { StylingService } from "features/link-decoration/stylingService";
import type { RenderedMdElementsRegistry } from "infrastructure/markdown/RenderedMdElementsRegistry";

export interface RegisterMarkdownProcessorsDeps {
	readonly app: App;
	readonly indexingService: IndexingService;
	readonly stylingService: StylingService;
	readonly renderedMdElementsRegistry: RenderedMdElementsRegistry;
}

/**
 * Registers the markdown post processor that decorates links and tracks
 * rendered elements for later cleanup.
 */
export function registerMarkdownProcessors(
	plugin: PluginHost,
	deps: RegisterMarkdownProcessorsDeps,
): void {
	plugin.registerMarkdownPostProcessor((el, ctx) =>
		markdownPostProcessor(
			el,
			ctx,
			deps.app,
			deps.indexingService,
			deps.stylingService,
			deps.renderedMdElementsRegistry,
		),
	);
}
