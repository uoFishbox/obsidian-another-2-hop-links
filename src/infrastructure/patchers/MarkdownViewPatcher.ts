import type { PluginHost } from "types/pluginHost";
import { MarkdownView, TFile } from "obsidian";
import { enableLogging, logger } from "shared/logging/logger";
import { getActiveInlineContainer } from "ui/shared/dom/domUtils";
import { applyPatch } from "infrastructure/capabilities/applyPatch";

export function initFilePatcher(plugin: PluginHost): void {
	patchViewLifecycle(plugin);
}

function patchViewLifecycle(plugin: PluginHost) {
	const ensureInlineContainers = (view: MarkdownView): void => {
		if (
			plugin.settings.displayMode !== "editor-inline" &&
			plugin.settings.displayMode !== "hybrid"
		) {
			return;
		}

		getActiveInlineContainer(view);
	};

	const applied = applyPatch(plugin, {
		id: "markdown-view:lifecycle",
		target: MarkdownView.prototype,
		method: "onload",
		wrap: (next) =>
			function (this: MarkdownView) {
				const result = next.call(this);
				try {
					ensureInlineContainers(this);
				} catch (e) {
					console.error(
						"[FilePatcher] Failed to inject container in onload",
						e,
					);
				}
				return result;
			},
	});

	applyPatch(plugin, {
		id: "markdown-view:onLoadFile",
		target: MarkdownView.prototype,
		method: "onLoadFile",
		wrap: (next) =>
			async function (this: MarkdownView, file: TFile) {
				const result = await next.call(this, file);
				if (this.file?.path === file.path) {
					ensureInlineContainers(this);
				}

				return result;
			},
	});

	applyPatch(plugin, {
		id: "markdown-view:onUnloadFile",
		target: MarkdownView.prototype,
		method: "onUnloadFile",
		wrap: (next) =>
			async function (this: MarkdownView, file: TFile) {
				plugin.componentController.unmountViewComponents(this);
				return await next.call(this, file);
			},
	});

	if (applied) {
		if (enableLogging) logger("[FilePatcher] MarkdownView lifecycle patched.");
	}
}
