import type { PluginHost } from "types/pluginHost";
import { enableLogging, logger } from "shared/logging/logger";
import { openTagNotesView } from "features/tag-notes/ui/TagNotesView";
import { areTagFeaturesEnabled } from "features/settings/model";
import { getGlobalSearchOpenGlobalSearch } from "infrastructure/capabilities/obsidianInternals";
import { applyPatch } from "infrastructure/capabilities/applyPatch";
import type { TaggedNote } from "types/domain";

export function initGlobalSearchPatcher(plugin: PluginHost): void {
	plugin.app.workspace.onLayoutReady(() => {
		patchGlobalSearch(plugin);
	});
}

function patchGlobalSearch(plugin: PluginHost): void {
	const capability = getGlobalSearchOpenGlobalSearch(plugin.app);
	if (!capability) {
		if (enableLogging)
			logger("[GlobalSearchPatcher] Skipped patch: global-search unavailable.");
		return;
	}

	const applied = applyPatch(plugin, {
		id: "global-search:openGlobalSearch",
		target: capability.instance,
		method: "openGlobalSearch",
		wrap: (next) => {
			let searchGeneration = 0;
			return function (this: unknown, query: string) {
				const currentGeneration = ++searchGeneration;
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
							let notes: TaggedNote[];
							try {
								notes = await indexingService.getNotesWithTag(tag);
							} catch (error) {
								if (currentGeneration !== searchGeneration) {
									return;
								}
								console.error(
									"[GlobalSearchPatcher] Tag search interception failed:",
									error,
								);
								next.call(this, query);
								return;
							}

							if (currentGeneration !== searchGeneration) {
								return;
							}
							if (notes.length === 0) {
								next.call(this, query);
								return;
							}

							if (enableLogging)
								logger(
									`[GlobalSearchPatcher] Intercepting tag search: "${tag}". Found ${notes.length} notes.`,
								);
							const sourcePath =
								plugin.app.workspace.getActiveFile()?.path ?? "";
							try {
								await openTagNotesView(plugin, tag, sourcePath, false);
							} catch (error) {
								if (currentGeneration !== searchGeneration) {
									return;
								}
								console.error(
									"[GlobalSearchPatcher] Tag search interception failed:",
									error,
								);
								next.call(this, query);
							}
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
