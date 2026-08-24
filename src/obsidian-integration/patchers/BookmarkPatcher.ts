import type { PluginHost } from "obsidian-integration/pluginHost";
import { normalizePath } from "obsidian";
import { applyPatch } from "obsidian-integration/capabilities/applyPatch";

type VaultAdapterWithWrite = {
	write: (
		normalizedPath: string,
		data: string,
		options?: unknown,
	) => Promise<unknown>;
};

export function initBookmarkPatcher(plugin: PluginHost): void {
	const bookmarksPath = normalizePath(`${plugin.app.vault.configDir}/bookmarks.json`);

	applyPatch(plugin, {
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
					plugin.app.workspace.trigger(
						"cosense-card-links:bookmarks-updated" as any,
					);
				}

				return result;
			},
	});
}
