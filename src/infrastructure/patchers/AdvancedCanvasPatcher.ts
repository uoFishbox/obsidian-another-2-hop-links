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
	return;
}
