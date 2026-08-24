import type { PluginHost } from "obsidian-integration/pluginHost";
import type { CanvasView, CanvasViewCanvas } from "obsidian-typings";
import { getCanvasSelectionData } from "obsidian-integration/capabilities/obsidianInternals";
import { applyPatch } from "obsidian-integration/capabilities/applyPatch";
const canvasPatchIds = new WeakMap<CanvasViewCanvas, string>();
let nextCanvasPatchId = 1;

function waitForCanvasViewRequest(
	plugin: PluginHost,
	patchCallback: (view: CanvasView) => void,
): void {
	applyPatch(plugin, {
		id: "view-registry:canvas",
		target: plugin.app.viewRegistry.viewByType,
		method: "canvas",
		wrap: (next) =>
			function (this: unknown, leaf: unknown) {
				const view = next.call(this, leaf as Parameters<typeof next>[0]);
				patchCallback(view as CanvasView);
				return view;
			},
	});
}

export function initCanvasPatcher(plugin: PluginHost): void {
	waitForCanvasViewRequest(plugin, (view) => patchCanvasView(plugin, view));
	setTimeout(() => {
		const leaves = plugin.app.workspace.getLeavesOfType("canvas");
		for (const leaf of leaves) {
			const view = leaf.view as CanvasView;
			if (view && view.canvas) {
				patchCanvasView(plugin, view);
			}
		}
	}, 100);
}

function patchCanvasView(plugin: PluginHost, view: CanvasView): void {
	const canvas = view.canvas;

	if (!canvas) return;
	let patchId = canvasPatchIds.get(canvas);
	if (!patchId) {
		patchId = `canvas:updateSelection:${nextCanvasPatchId++}`;
		canvasPatchIds.set(canvas, patchId);
	}

	const applied = applyPatch(plugin, {
		id: patchId,
		target: canvas,
		method: "updateSelection",
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

				const canvasWithSelectionData = getCanvasSelectionData(this);
				if (!canvasWithSelectionData) {
					return result;
				}

				const selectedNodes =
					canvasWithSelectionData.getSelectionData?.()?.nodes ?? [];
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
