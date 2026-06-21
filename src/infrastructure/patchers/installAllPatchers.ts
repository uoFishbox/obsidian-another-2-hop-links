import type { PluginHost } from "types/pluginHost";
import { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";
import { initCanvasPatcher } from "infrastructure/patchers/CanvasPatcher";
import { initFilePatcher } from "infrastructure/patchers/MarkdownViewPatcher";
import { initPropertyPatcher } from "infrastructure/patchers/PropertyPatcher";
import { initWorkspacePatcher } from "infrastructure/patchers/workspacePatchers";
import { initGlobalSearchPatcher } from "infrastructure/patchers/GlobalSearchPatcher";
import { initBookmarkPatcher } from "infrastructure/patchers/BookmarkPatcher";
import { initPagePreviewShadowDomPatcher } from "infrastructure/patchers/PagePreviewShadowDomPatcher";
import type { StylingService } from "features/link-decoration/stylingService";
import type { PropertyWidgetStyler } from "features/link-decoration/propertyWidgetStyler";

export interface InstallAllPatchersDeps {
	readonly stylingService: StylingService;
	readonly propertyWidgetStyler: PropertyWidgetStyler;
}

/**
 * Installs every Obsidian-internal monkey-patch in one call.
 * Must run after layout ready (the individual patchers register their own
 * onLayoutReady hooks as needed).
 */
export function installAllPatchers(
	plugin: PluginHost,
	registry: PatchRegistry,
	deps: InstallAllPatchersDeps,
): void {
	initCanvasPatcher(plugin, registry);
	initFilePatcher(plugin, registry);
	initPropertyPatcher(
		plugin,
		registry,
		deps.stylingService,
		deps.propertyWidgetStyler,
	);
	initWorkspacePatcher(plugin, registry);
	initGlobalSearchPatcher(plugin, registry);
	initBookmarkPatcher(plugin, registry);
	initPagePreviewShadowDomPatcher(plugin, registry);
}
