import type { PluginHost } from "types/pluginHost";
import type { PatchRegistry } from "infrastructure/capabilities/PatchRegistry";

export function waitForViewRequest<T>(
	plugin: PluginHost,
	patchRegistry: PatchRegistry,
	viewType: string,
	patchCallback: (view: T) => void,
): void {
	patchRegistry.apply(plugin, {
		id: `view-registry:${viewType}`,
		target: plugin.app.viewRegistry.viewByType,
		method: viewType,
		risk: "low",
		enabled: true,
		wrap: (next) =>
			function (this: unknown, leaf: unknown) {
				const view = next.call(this, leaf as Parameters<typeof next>[0]);
				patchCallback(view as T);
				return view;
			},
	});
}
