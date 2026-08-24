import type { TFile } from "obsidian";
import { createViewLinkContext } from "obsidian-integration/views/createViewLinkContext";
import type { LinkContext } from "cards/context/linkContext";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { TwoHopState } from "two-hop/state/TwoHopState.svelte";
import type { PluginSettings } from "settings/model";
import type { ViewServices } from "obsidian-integration/views/viewServices";

export function createDefaultCardCollectionState(
	viewServices: ViewServices,
	settings: PluginSettings,
): CardCollectionState {
	return viewServices.createCardCollectionState(settings);
}

export function createDefaultTwoHopState(
	viewServices: ViewServices,
	settings: PluginSettings,
): TwoHopState {
	return viewServices.createTwoHopState(settings);
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
