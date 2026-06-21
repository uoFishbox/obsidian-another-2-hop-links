import type { PluginHost } from "types/pluginHost";
import { buildLivePreviewPlugin } from "infrastructure/markdown/livePreview";
import { buildEditorInlineFocusBridgeExtension } from "features/keyboard-navigation/editorInlineFocusBridge";
import type { LinkStatusService } from "features/link-decoration/linkStatusService";

export interface RegisterEditorExtensionsDeps {
	readonly linkStatusService: LinkStatusService;
}

/**
 * Registers CodeMirror 6 editor extensions (live preview decoration and
 * inline focus bridge) with the plugin.
 */
export function registerEditorExtensions(
	plugin: PluginHost,
	deps: RegisterEditorExtensionsDeps,
): void {
	plugin.registerEditorExtension(buildLivePreviewPlugin(deps.linkStatusService));
	plugin.registerEditorExtension(
		buildEditorInlineFocusBridgeExtension(plugin),
	);
}
