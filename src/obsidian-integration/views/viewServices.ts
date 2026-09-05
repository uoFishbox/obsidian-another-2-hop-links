import type { TFile } from "obsidian";
import type { PluginSettings } from "settings/model";
import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
import type { LinkContext } from "cards/context/linkContext";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { TwoHopState } from "two-hop/state/TwoHopState.svelte";
import type { AllNotesCatalog } from "search/all-notes/allNotesCatalog";
import type { KeyboardNavigationSurfaceRegistry } from "obsidian-integration/navigation/keyboardNavigationSurface";

/** UI views に対して composition root が提供する生成・共有 capability。 */
export interface ViewServices {
	/** 検索・一覧 view 用のカード表示状態を生成する。 */
	createCardCollectionState(settings: PluginSettings): CardCollectionState;
	/** 現在の設定に結び付いた独立 store を生成する。 */
	createTwoHopState(settings: PluginSettings): TwoHopState;
	/** 指定ファイルを source とする view 用 link context を生成する。 */
	createLinkContext(sourceFile: TFile, settings: PluginSettings): LinkContext;
	/** plugin load 単位で共有される preview runtime。 */
	readonly previewRuntime: PreviewRuntime;
	/** plugin load 単位で共有される All Notes のsource・sort cache。 */
	readonly allNotesCatalog: AllNotesCatalog;
	/** mount 済み card surface を keyboard navigation に公開する registry。 */
	readonly keyboardNavigationSurfaceRegistry: KeyboardNavigationSurfaceRegistry;
}
