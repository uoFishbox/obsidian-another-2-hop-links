import type { TFile } from "obsidian";
import { createViewLinkContext } from "ui/shared/views/createViewLinkContext";
import type { LinkContext } from "ui/context/linkContext";
import type { TwoHopApplicationStore } from "features/two-hop/application/TwoHopApplicationStore.svelte";
import type { PluginSettings } from "features/settings/model";
import type { ViewServices } from "ui/shared/views/viewServices";

export function createDefaultApplicationStore(
	viewServices: ViewServices,
	settings: PluginSettings,
): TwoHopApplicationStore {
	return viewServices.createApplicationStore(settings);
}

export function createLinkContextForView(
	viewServices: ViewServices,
	sourceFile: TFile,
	settings: PluginSettings,
	options?: { wrapForView?: boolean; closeView?: () => void },
): LinkContext {
	const baseLinkContext = viewServices.createLinkContext(sourceFile, settings);
	const wrapForView = options?.wrapForView ?? true;
	if (!wrapForView) {
		return baseLinkContext;
	}
	return createViewLinkContext(baseLinkContext, options?.closeView ?? (() => {}));
}
