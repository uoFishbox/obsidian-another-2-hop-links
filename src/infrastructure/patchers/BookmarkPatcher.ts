import type { PluginHost } from "types/pluginHost";
import { normalizePath } from "obsidian";
import { enableLogging, logger } from "utils/logger";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

type VaultAdapterWithWrite = {
	write: (
		normalizedPath: string,
		data: string,
		options?: unknown,
	) => Promise<unknown>;
};

export function initBookmarkPatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	const bookmarksPath = normalizePath(
		`${plugin.app.vault.configDir}/bookmarks.json`,
	);

	const applied = patchRegistry.apply(plugin, {
		id: "vault-adapter:write-bookmarks",
		target: plugin.app.vault.adapter as VaultAdapterWithWrite,
		method: "write",
		risk: "low",
		enabled: true,
		wrap: (next) =>
			async function (
				this: unknown,
				normalizedPath: string,
				data: string,
				options?: unknown,
			) {
				const result = await next.call(this, normalizedPath, data, options);

				// ブックマークファイルが更新された場合、カスタムイベントを発火
				if (normalizedPath === bookmarksPath) {
					if (enableLogging) logger(`[BookmarkPatcher] Bookmarks updated, triggering event.`);
					plugin.app.workspace.trigger(
						"cosense-card-links:bookmarks-updated" as any,
					);
				}

				return result;
			},
	});

	if (applied) {
		if (enableLogging) logger("[BookmarkPatcher] Vault adapter patched for bookmarks.");
	}
}
