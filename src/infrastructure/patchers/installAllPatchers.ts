import type { PluginHost } from "types/pluginHost";
import { initCanvasPatcher } from "infrastructure/patchers/CanvasPatcher";
import { initFilePatcher } from "infrastructure/patchers/MarkdownViewPatcher";
import { initPropertyPatcher } from "infrastructure/patchers/PropertyPatcher";
import { initWorkspacePatcher } from "infrastructure/patchers/workspacePatchers";
import { initGlobalSearchPatcher } from "infrastructure/patchers/GlobalSearchPatcher";
import { initBookmarkPatcher } from "infrastructure/patchers/BookmarkPatcher";
import { initPagePreviewShadowDomPatcher } from "infrastructure/patchers/PagePreviewShadowDomPatcher";
import type { PropertyWidgetStyler } from "features/link-decoration/propertyWidgetStyler";

export interface InstallAllPatchersDeps {
	readonly propertyWidgetStyler: PropertyWidgetStyler;
}

/**
 * Installs every Obsidian-internal monkey-patch in one call.
 * Must run after layout ready (the individual patchers register their own
 * onLayoutReady hooks as needed).
 */
export function installAllPatchers(
	plugin: PluginHost,
	deps: InstallAllPatchersDeps,
): void {
	initCanvasPatcher(plugin);
	initFilePatcher(plugin);
	initPropertyPatcher(plugin, deps.propertyWidgetStyler);
	initWorkspacePatcher(plugin);
	initGlobalSearchPatcher(plugin);
	initBookmarkPatcher(plugin);
	initPagePreviewShadowDomPatcher(plugin);
}
