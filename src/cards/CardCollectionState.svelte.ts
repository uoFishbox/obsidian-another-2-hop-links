import type { SortOption } from "cards/sorting";
import { CARD_LAYOUT_SETTING_KEYS, type PluginSettings } from "settings/model";
import {
	clearSectionExpandedLimit,
	getDefaultSectionVisibleLimit,
	getSectionExpandedLimit,
	resolveSortOption,
	setSectionExpandedLimit,
	type SectionExpansionLimits,
} from "cards/sectionExpansion";
import { PreviewRevisionState } from "card-preview/PreviewRevisionState.svelte";

const DISPLAY_REFRESH_EXCLUDED_SETTINGS = new Set<keyof PluginSettings>([
	"lastUsedSortOption",
	...CARD_LAYOUT_SETTING_KEYS,
]);

function getChangedSettingKeys(
	previous: PluginSettings,
	next: PluginSettings,
): Array<keyof PluginSettings> {
	return (Object.keys(next) as Array<keyof PluginSettings>).filter(
		(key) => previous[key] !== next[key],
	);
}

function shouldRefreshDisplayData(changedKeys: Array<keyof PluginSettings>): boolean {
	return changedKeys.some((key) => !DISPLAY_REFRESH_EXCLUDED_SETTINGS.has(key));
}

/** Shared state for searchable card collections. */
export class CardCollectionState {
	declare sortOption: SortOption;
	declare settings: PluginSettings;
	declare sectionExpandedLimits: SectionExpansionLimits;
	declare updateVersion: number;
	declare readonly initialVisibleCount: number;
	declare readonly loadMoreIncrement: number;
	readonly previewState: PreviewRevisionState;

	constructor(
		initialSettings: PluginSettings,
		private readonly onSortChange: (newSortOption: SortOption) => void,
		private readonly onUpdateContentSearch: (enabled: boolean) => void = () => {},
	) {
		this.sortOption = $state<SortOption>(initialSettings.lastUsedSortOption);
		this.settings = $state.raw<PluginSettings>(initialSettings);
		this.sectionExpandedLimits = $state.raw<SectionExpansionLimits>({});
		this.updateVersion = $state(0);
		this.initialVisibleCount = $derived(this.settings.defaultVisibleLinkCount);
		this.loadMoreIncrement = $derived(this.settings.loadMoreLinkIncrement);
		this.previewState = new PreviewRevisionState();
	}

	triggerUpdate(): void {
		this.updateVersion += 1;
	}

	getSectionExpandedLimit(sectionId: string): number | undefined {
		return getSectionExpandedLimit(
			this.sectionExpandedLimits,
			this.settings,
			sectionId,
		);
	}

	setSectionExpandedLimit(sectionId: string, limit: number): void {
		const next = setSectionExpandedLimit(
			this.sectionExpandedLimits,
			sectionId,
			limit,
		);
		if (next !== this.sectionExpandedLimits) {
			this.sectionExpandedLimits = next;
		}
	}

	clearSectionExpandedLimit(sectionId: string): void {
		const next = clearSectionExpandedLimit(this.sectionExpandedLimits, sectionId);
		if (next !== this.sectionExpandedLimits) {
			this.sectionExpandedLimits = next;
		}
	}

	getDefaultSectionVisibleLimit(): number {
		return getDefaultSectionVisibleLimit(this.settings);
	}

	getSortOption(): SortOption {
		return this.sortOption;
	}

	setSortOption(sortOption: SortOption): void {
		const next = resolveSortOption(this.sortOption, sortOption);
		if (next !== this.sortOption) this.onSortChange(next);
		this.sortOption = next;
	}

	setContentSearchEnabled(enabled: boolean): void {
		this.onUpdateContentSearch(enabled);
	}

	setSettings(settings: PluginSettings): void {
		const changedKeys = getChangedSettingKeys(this.settings, settings);
		this.settings = settings;
		if (shouldRefreshDisplayData(changedKeys)) this.triggerUpdate();
	}

	reset(): void {
		this.sortOption = this.settings.lastUsedSortOption;
		this.sectionExpandedLimits = {};
		this.previewState.reset();
	}

	destroy(): void {
		this.reset();
	}
}
