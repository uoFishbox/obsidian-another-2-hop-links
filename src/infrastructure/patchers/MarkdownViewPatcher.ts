import type { PluginHost } from "types/pluginHost";
import { MarkdownView, TFile } from "obsidian";
import { enableLogging, logger } from "utils/logger";
import { getContainerElements } from "ui/utils/domUtils";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

export function initFilePatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	patchViewLifecycle(plugin, patchRegistry);
}

function patchViewLifecycle(plugin: PluginHost, patchRegistry: PatchRegistry) {
	const ensureInlineContainers = (view: MarkdownView): void => {
		if (
			plugin.settings.displayMode !== "editor-inline" &&
			plugin.settings.displayMode !== "hybrid"
		) {
			return;
		}

		// 実マウントは DisplayModeController 側に一本化し、
		// ここではコンテナ準備だけを担当する。
		getContainerElements(view);
	};

	const applied = patchRegistry.apply(plugin, {
		id: "markdown-view:lifecycle",
		target: MarkdownView.prototype,
		method: "onload",
		risk: "low",
		enabled: true,
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

	patchRegistry.apply(plugin, {
		id: "markdown-view:onLoadFile",
		target: MarkdownView.prototype,
		method: "onLoadFile",
		risk: "low",
		enabled: true,
		wrap: (next) =>
			async function (this: MarkdownView, file: TFile) {
				const result = await next.call(this, file);
				if (this.file?.path === file.path) {
					ensureInlineContainers(this);
				}

				return result;
			},
	});

	patchRegistry.apply(plugin, {
		id: "markdown-view:onUnloadFile",
		target: MarkdownView.prototype,
		method: "onUnloadFile",
		risk: "low",
		enabled: true,
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
