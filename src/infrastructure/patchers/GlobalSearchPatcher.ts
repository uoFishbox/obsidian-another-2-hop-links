import type { PluginHost } from "types/pluginHost";
import { enableLogging, logger } from "shared/logging/logger";
import { openTagNotesView } from "features/tag-notes/ui/TagNotesView";
import { areTagFeaturesEnabled } from "features/settings/model";
import { ObsidianInternalFacade } from "infrastructure/capabilities/ObsidianInternalFacade";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

export function initGlobalSearchPatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	plugin.app.workspace.onLayoutReady(() => {
		patchGlobalSearch(plugin, patchRegistry);
	});
}

function patchGlobalSearch(plugin: PluginHost, patchRegistry: PatchRegistry): void {
	const capability = new ObsidianInternalFacade(
		plugin.app,
	).getGlobalSearchOpenGlobalSearch();
	if (!capability.ok) {
		if (enableLogging)
			logger(`[GlobalSearchPatcher] Skipped patch: ${capability.reason}.`);
		return;
	}

	const applied = patchRegistry.apply(plugin, {
		id: "global-search:openGlobalSearch",
		target: capability.value.instance,
		method: "openGlobalSearch",
		risk: capability.risk,
		enabled: true,
		wrap: (next) => {
			return function (this: unknown, query: string) {
				if (
					!plugin.settings.enableGlobalSearchTagModal ||
					!areTagFeaturesEnabled(plugin.settings)
				) {
					return next.call(this, query);
				}

				if (typeof query === "string" && query.startsWith("tag:")) {
					const tagRaw = query.substring(4).trim();
					const tag = tagRaw.startsWith("#")
						? tagRaw.substring(1).toLowerCase()
						: tagRaw.toLowerCase();

					const indexingService = plugin.indexingService;

					if (indexingService) {
						void (async () => {
							const notes = await indexingService.getNotesWithTag(tag);
							if (notes.length > 0) {
								if (enableLogging)
									logger(
										`[GlobalSearchPatcher] Intercepting tag search: "${tag}". Found ${notes.length} notes.`,
									);
								const sourcePath =
									plugin.app.workspace.getActiveFile()?.path ?? "";
								void openTagNotesView(plugin, tag, sourcePath, false);
								return;
							}

							next.call(this, query);
						})();

						// インデックス完了を待ってから判定するため、ここでは即 return する
						return;
					}
				}
				return next.call(this, query);
			};
		},
	});

	if (applied) {
		if (enableLogging)
			logger("[GlobalSearchPatcher] Successfully patched openGlobalSearch.");
	}
}
