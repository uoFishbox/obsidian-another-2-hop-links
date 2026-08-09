import type { PluginHostUi } from "types/pluginHostUi";
import type { TFile } from "obsidian";
import { createViewLinkContext } from "ui/shared/views/createViewLinkContext";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { PluginSettings } from "features/settings/model";
import { areTagFeaturesEnabled } from "features/settings/model";

export function createDefaultApplicationStore(
	plugin: PluginHostUi,
	settings: PluginSettings = plugin.settings,
): ApplicationStore {
	const displayDataBuilder = plugin.createDisplayDataBuilder();
	return plugin.createApplicationStore(
		settings,
		displayDataBuilder,
		(file: TFile, onProgress, signal) =>
			plugin.getTwoHopResolveSnapshot(file, onProgress, {
				includeTaggedNotes:
					areTagFeaturesEnabled(plugin.settings) &&
					plugin.settings.showTagsSection,
				signal,
			}),
	);
}

export function createLinkContextForView(
	plugin: PluginHostUi,
	sourceFile: TFile,
	settings: PluginSettings = plugin.settings,
	options?: { wrapForView?: boolean; closeView?: () => void },
): LinkContext {
	const linkContextFactory = plugin.getLinkContextFactory();
	const baseLinkContext = linkContextFactory(sourceFile, settings);
	const wrapForView = options?.wrapForView ?? true;
	if (!wrapForView) {
		return baseLinkContext;
	}
	return createViewLinkContext(baseLinkContext, options?.closeView ?? (() => {}));
}
