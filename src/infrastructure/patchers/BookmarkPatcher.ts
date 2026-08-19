import type { PluginHost } from "types/pluginHost";
import { normalizePath } from "obsidian";
import { enableLogging, logger } from "shared/logging/logger";
import { applyPatch } from "infrastructure/capabilities/applyPatch";

type VaultAdapterWithWrite = {
	write: (
		normalizedPath: string,
		data: string,
		options?: unknown,
	) => Promise<unknown>;
};

export function initBookmarkPatcher(plugin: PluginHost): void {
	const bookmarksPath = normalizePath(`${plugin.app.vault.configDir}/bookmarks.json`);

	const applied = applyPatch(plugin, {
		id: "vault-adapter:write-bookmarks",
		target: plugin.app.vault.adapter as VaultAdapterWithWrite,
		method: "write",
		wrap: (next) =>
			async function (
				this: unknown,
				normalizedPath: string,
				data: string,
				options?: unknown,
			) {
				const result = await next.call(this, normalizedPath, data, options);

				if (normalizedPath === bookmarksPath) {
					if (enableLogging)
						logger(
							`[BookmarkPatcher] Bookmarks updated, triggering event.`,
						);
					plugin.app.workspace.trigger(
						"cosense-card-links:bookmarks-updated" as any,
					);
				}

				return result;
			},
	});

	if (applied) {
		if (enableLogging)
			logger("[BookmarkPatcher] Vault adapter patched for bookmarks.");
	}
}
