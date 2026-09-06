import type { TFile } from "obsidian";
import type { PluginSettings } from "settings/model";
import type { PreviewRuntime } from "card-preview/runtime/previewRuntime";
import type { LinkContext } from "cards/context/linkContext";
import type { CardCollectionState } from "cards/CardCollectionState.svelte";
import type { TwoHopState } from "two-hop/state/TwoHopState.svelte";
import type { AllNotesCatalog } from "search/all-notes/allNotesCatalog";
import type { KeyboardNavigationSurfaceRegistry } from "obsidian-integration/navigation/keyboardNavigationSurface";

export interface ViewServices {
	createCardCollectionState(settings: PluginSettings): CardCollectionState;
	createTwoHopState(settings: PluginSettings): TwoHopState;
	createLinkContext(sourceFile: TFile, settings: PluginSettings): LinkContext;
	readonly previewRuntime: PreviewRuntime;
	readonly allNotesCatalog: AllNotesCatalog;
	readonly keyboardNavigationSurfaceRegistry: KeyboardNavigationSurfaceRegistry;
}
