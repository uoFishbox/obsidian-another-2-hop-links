import type { StateEffectType } from "@codemirror/state";
import type { TFile } from "obsidian";
import type { DisplayDataBuilder } from "features/two-hop/application/displayDataBuilder";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ResolveTwoHopLinks } from "features/two-hop/application/TwoHopLinksLoader";
import type { PluginHost } from "types/pluginHost";
import type { PluginSettings } from "features/settings/model";
import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";

export interface PluginHostUi extends PluginHost {
	readonly forceRedrawEffect: StateEffectType<undefined>;
	createDisplayDataBuilder(): DisplayDataBuilder;
	getLinkContextFactory(): (file: TFile, settings: PluginSettings) => LinkContext;
	getPreviewRuntime(): PreviewRuntime;
	createApplicationStore(
		settings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore;
	getOrCreateApplicationStore(
		leafId: string,
		filePath: string,
		settings: PluginSettings,
		displayDataBuilder: DisplayDataBuilder,
		resolveTwoHopLinks: ResolveTwoHopLinks,
	): ApplicationStore;
}
