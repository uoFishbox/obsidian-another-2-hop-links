import type { TFile } from "obsidian";
import type { PluginSettings } from "features/settings/model";
import type { PreviewRuntime } from "features/card-preview/runtime/previewRuntime";
import type { LinkContext } from "ui/context/linkContext";
import type { TwoHopApplicationStore } from "features/two-hop/application/TwoHopApplicationStore.svelte";

/** UI views に対して composition root が提供する生成・共有 capability。 */
export interface ViewServices {
	/** 現在の設定に結び付いた独立 store を生成する。 */
	createApplicationStore(settings: PluginSettings): TwoHopApplicationStore;
	/** 指定ファイルを source とする view 用 link context を生成する。 */
	createLinkContext(sourceFile: TFile, settings: PluginSettings): LinkContext;
	/** plugin load 単位で共有される preview runtime。 */
	readonly previewRuntime: PreviewRuntime;
}
