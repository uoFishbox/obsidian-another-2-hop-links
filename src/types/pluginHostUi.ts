import type { StateEffectType } from "@codemirror/state";
import type { TFile } from "obsidian";
import type { DisplayDataBuilder } from "application/presenters/displayDataBuilder";
import type { LinkContext } from "ui/context/linkContext";
import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
import type { ResolveTwoHopLinks } from "ui/stores/application/TwoHopLinksLoader";
import type { PluginHost } from "types/pluginHost";
import type { PluginSettings } from "types/settings";

/**
 * PluginHost の UI 層向け拡張。
 * UI 表示や Svelte store の生成に必要なファサードを基本ホスト型から分離する。
 */
export interface PluginHostUi extends PluginHost {
	readonly forceRedrawEffect: StateEffectType<undefined>;
	createDisplayDataBuilder(): DisplayDataBuilder;
	getLinkContextFactory(): (file: TFile, settings: PluginSettings) => LinkContext;
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
