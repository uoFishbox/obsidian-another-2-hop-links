import type { PluginHost } from "types/pluginHost";
import { enableLogging, logger } from "utils/logger";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

type MetadataCacheWithAdvancedCanvas = {
	registerInternalLinkAC: (canvasName: string, from: string, to: string) => unknown;
};

export function initAdvancedCanvasPatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	// 一時的に無効化
	return;

	// Obsidianのレイアウト準備完了後に実行し、ロード順序の問題を緩和する
	plugin.app.workspace.onLayoutReady(() => {
		// 少し遅延させることで、advanced-canvasのパッチが適用されるのを待つ
		setTimeout(() => patchAdvancedCanvas(plugin, patchRegistry), 100);
	});
}

function patchAdvancedCanvas(plugin: PluginHost, patchRegistry: PatchRegistry): void {
	if (!plugin.settings.enableAdvancedCanvasIntegration) {
		if (enableLogging)
			logger(
				"[AdvancedCanvasPatcher] Integration is disabled in settings. Skipping patch.",
			);
		return;
	}

	const advancedCanvasPlugin = plugin.app.plugins.plugins["advanced-canvas"];
	if (!advancedCanvasPlugin) {
		if (enableLogging)
			logger(
				"[AdvancedCanvasPatcher] Advanced Canvas plugin not found. Skipping patch.",
			);
		return;
	}

	const metadataCache = plugin.app
		.metadataCache as unknown as MetadataCacheWithAdvancedCanvas;
	if (typeof metadataCache.registerInternalLinkAC !== "function") {
		console.warn(
			"[AdvancedCanvasPatcher] `registerInternalLinkAC` function not found on metadataCache. Patching aborted.",
		);
		return;
	}

	const indexUpdateQueue = plugin.indexUpdateQueue;
	const applied = patchRegistry.apply(plugin, {
		id: "advanced-canvas:registerInternalLinkAC",
		target: metadataCache,
		method: "registerInternalLinkAC",
		risk: "high",
		enabled: Boolean(plugin.settings.enableAdvancedCanvasIntegration),
		wrap: (next) => {
			return function (
				this: unknown,
				canvasName: string,
				from: string,
				to: string,
			) {
				// 1. 元の関数を呼び出す
				const result = next.call(this, canvasName, from, to);

				// 2. TwoHopプラグインのEventManagerに更新を通知
				if (typeof from === "string") {
					if (enableLogging)
						logger(
							`[AdvancedCanvasPatcher] Detected link creation: ${from} -> ${String(
								to,
							)}. Requesting index update.`,
						);
					indexUpdateQueue.requestIndexUpdateForFile(from);
				}

				return result;
			};
		},
	});

	if (applied) {
		if (enableLogging)
			logger(
				"[AdvancedCanvasPatcher] Successfully patched `registerInternalLinkAC` for TwoHop link indexing.",
			);
	}
}
