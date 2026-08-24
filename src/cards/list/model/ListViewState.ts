import type { SortOption } from "cards/sorting";
import type { PluginSettings } from "settings/model";
import type { AppContextApplicationStore } from "cards/context/linkContext";
import type { PreviewRevisionReader } from "preview/PreviewRevisionState.svelte";

/** State capabilities required by the searchable list-view feature. */
export interface ListViewState extends AppContextApplicationStore {
	readonly sortOption: SortOption;
	readonly updateVersion: number;
	readonly previewState: PreviewRevisionReader;
	readonly initialVisibleCount: number;
	readonly loadMoreIncrement: number;
	readonly settings: PluginSettings;

	setSortOption(option: SortOption): void;
	setContentSearchEnabled(enabled: boolean): void;
	getDefaultSectionVisibleLimit?(): number;
	getSectionExpandedLimit?(sectionId: string): number | undefined;
	setSectionExpandedLimit?(sectionId: string, limit: number): void;
}
