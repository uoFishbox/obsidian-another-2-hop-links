import type { SortOption } from "core/sorting";
import type { PluginSettings } from "features/settings/model";
import type { AppContextApplicationStore } from "ui/context/linkContext";

/** State capabilities required by the searchable list-view feature. */
export interface ListViewState extends AppContextApplicationStore {
	readonly sortOption: SortOption;
	readonly updateVersion: number;
	readonly previewGlobalVersion: number;
	readonly previewPathVersions: Readonly<Record<string, number>>;
	readonly initialVisibleCount: number;
	readonly loadMoreIncrement: number;
	readonly settings: PluginSettings;

	setSortOption(option: SortOption): void;
	setContentSearchEnabled(enabled: boolean): void;
	getDefaultSectionVisibleLimit?(): number;
	getSectionExpandedLimit?(sectionId: string): number | undefined;
	setSectionExpandedLimit?(sectionId: string, limit: number): void;
}
