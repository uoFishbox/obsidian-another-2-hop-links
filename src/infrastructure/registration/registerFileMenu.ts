import { TFile, type App } from "obsidian";
import type { PluginHost } from "types/pluginHost";
import {
	downloadAsFile,
	exportToClipboard,
} from "features/export/exportService";
import type { TwoHopLinkResult, ResolveProgress } from "types/domain";
import type { ResolveOptions } from "core/indexing/two-hop-resolver/TwoHopLinkResolver";

export interface RegisterFileMenuDeps {
	readonly app: App;
	readonly getTwoHopLinkResult: (
		file: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	) => Promise<TwoHopLinkResult>;
}

/**
 * Registers the file-menu items for copying/exporting 2-hop links.
 */
export function registerFileMenu(
	plugin: PluginHost,
	deps: RegisterFileMenuDeps,
): void {
	plugin.registerEvent(
		deps.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFile)) return;

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Copy 2-hop links to clipboard")
					.setIcon("copy")
					.setSection("action")
					.onClick(async () => {
						const result = await deps.getTwoHopLinkResult(file);
						await exportToClipboard(deps.app, result);
					});
			});

			menu.addItem((item) => {
				item.setTitle("Export 2-hop links to file")
					.setIcon("download")
					.setSection("action")
					.onClick(async () => {
						const result = await deps.getTwoHopLinkResult(file);
						await downloadAsFile(deps.app, result);
					});
			});
		}),
	);
}
