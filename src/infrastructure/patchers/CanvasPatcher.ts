import type { PluginHost } from "types/pluginHost";
import { waitForViewRequest } from "./patcherUtils";
import type { CanvasView, CanvasViewCanvas } from "obsidian-typings";
import { ObsidianInternalFacade } from "infrastructure/capabilities/ObsidianInternalFacade";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";
const canvasPatchIds = new WeakMap<CanvasViewCanvas, string>();
let nextCanvasPatchId = 1;

export function initCanvasPatcher(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
): void {
	// これから新しく開かれるCanvasビューへのパッチ
	waitForViewRequest<CanvasView>(plugin, patchRegistry, "canvas", (view) =>
		patchCanvasView(plugin, patchRegistry, view),
	);
	// 既に開かれているCanvasビューへのパッチ
	// onLayoutReadyの時点で既にロードされているビューに対して適用する
	// 起動速度への影響を最小限にするため、setTimeoutでカレントの実行スタックから逃がす
	setTimeout(() => {
		const leaves = plugin.app.workspace.getLeavesOfType("canvas");
		for (const leaf of leaves) {
			const view = leaf.view as CanvasView;
			if (view && view.canvas) {
				patchCanvasView(plugin, patchRegistry, view);
			}
		}
	}, 100);
}

function patchCanvasView(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
	view: CanvasView,
): void {
	const canvas = view.canvas;

	if (!canvas) return;
	let patchId = canvasPatchIds.get(canvas);
	if (!patchId) {
		patchId = `canvas:updateSelection:${nextCanvasPatchId++}`;
		canvasPatchIds.set(canvas, patchId);
	}

	const applied = patchRegistry.apply(plugin, {
		id: patchId,
		target: canvas,
		method: "updateSelection",
		risk: "medium",
		enabled: true,
		wrap: (next) =>
			function (this: CanvasViewCanvas, update: () => void) {
				const result = next.call(this, update);

				const settings = plugin.settings;
				const shouldHandleCanvasSelection =
					(settings.displayMode === "sidebar-view" ||
						settings.displayMode === "hybrid") &&
					(settings.showTwoHopForSelectedCanvasFileNode ?? true);

				if (!shouldHandleCanvasSelection) {
					return result;
				}

				const capability = new ObsidianInternalFacade(
					plugin.app,
				).getCanvasSelectionData(this);
				if (!capability.ok) {
					return result;
				}

				const selectedNodes =
					capability.value.getSelectionData?.()?.nodes ?? [];
				plugin.app.workspace.trigger(
					"cosense-card-links:canvas-selection-changed" as any,
					this,
					selectedNodes,
				);

				return result;
			},
	});

	if (!applied) {
		return;
	}
}
