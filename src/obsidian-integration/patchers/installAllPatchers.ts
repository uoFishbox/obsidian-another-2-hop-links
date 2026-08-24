import type { PluginHost } from "obsidian-integration/pluginHost";
import { initCanvasPatcher } from "obsidian-integration/patchers/CanvasPatcher";
import { initFilePatcher } from "obsidian-integration/patchers/MarkdownViewPatcher";
import { initPropertyPatcher } from "obsidian-integration/patchers/PropertyPatcher";
import { initWorkspacePatcher } from "obsidian-integration/patchers/workspacePatchers";
import { initGlobalSearchPatcher } from "obsidian-integration/patchers/GlobalSearchPatcher";
import { initBookmarkPatcher } from "obsidian-integration/patchers/BookmarkPatcher";
import { initPagePreviewShadowDomPatcher } from "obsidian-integration/patchers/PagePreviewShadowDomPatcher";
import type { PropertyWidgetStyler } from "obsidian-integration/link-decoration/propertyWidgetStyler";

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
