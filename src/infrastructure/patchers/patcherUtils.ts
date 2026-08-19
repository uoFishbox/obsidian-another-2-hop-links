import type { PluginHost } from "types/pluginHost";
import { applyPatch } from "infrastructure/capabilities/applyPatch";

export function waitForViewRequest<T>(
	plugin: PluginHost,
	viewType: string,
	patchCallback: (view: T) => void,
): void {
	applyPatch(plugin, {
		id: `view-registry:${viewType}`,
		target: plugin.app.viewRegistry.viewByType,
		method: viewType,
		wrap: (next) =>
			function (this: unknown, leaf: unknown) {
				const view = next.call(this, leaf as Parameters<typeof next>[0]);
				patchCallback(view as T);
				return view;
			},
	});
}
