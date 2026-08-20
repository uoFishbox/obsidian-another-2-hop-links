import type { SortOption } from "core/sorting";
import { CARD_LAYOUT_SETTING_KEYS, type PluginSettings } from "features/settings/model";
import {
	clearSectionExpandedLimit,
	getDefaultSectionVisibleLimit,
	getSectionExpandedLimit,
	resolveSortOption,
	setSectionExpandedLimit,
	type SectionExpansionLimits,
} from "./viewUiStateManager";

export type PreviewInvalidation = "all" | ReadonlySet<string> | undefined;

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

/** Shared view, settings, pagination, and preview state for application UI. */
export class ApplicationUiState {
	declare sortOption: SortOption;
	declare settings: PluginSettings;
	declare sectionExpandedLimits: SectionExpansionLimits;
	declare updateVersion: number;
	declare previewGlobalVersion: number;
	declare previewPathVersions: Record<string, number>;
	declare readonly initialVisibleCount: number;
	declare readonly loadMoreIncrement: number;

	constructor(
		initialSettings: PluginSettings,
		private readonly onSortChange: (newSortOption: SortOption) => void,
		private readonly onUpdateContentSearch: (enabled: boolean) => void = () => {},
	) {
		this.sortOption = $state<SortOption>(initialSettings.lastUsedSortOption);
		this.settings = $state.raw<PluginSettings>(initialSettings);
		this.sectionExpandedLimits = $state.raw<SectionExpansionLimits>({});
		this.updateVersion = $state(0);
		this.previewGlobalVersion = $state(0);
		this.previewPathVersions = $state.raw<Record<string, number>>({});
		this.initialVisibleCount = $derived(this.settings.defaultVisibleLinkCount);
		this.loadMoreIncrement = $derived(this.settings.loadMoreLinkIncrement);
	}

	triggerUpdate(): void {
		this.updateVersion += 1;
	}

	getPreviewRenderVersion(path: string): string {
		return `${this.previewGlobalVersion}:${this.previewPathVersions[path] ?? 0}`;
	}

	invalidatePreviews(invalidation: PreviewInvalidation): void {
		if (!invalidation) return;

		if (invalidation === "all") {
			this.previewGlobalVersion += 1;
			return;
		}

		const nextPathVersions = { ...this.previewPathVersions };
		for (const path of invalidation) {
			nextPathVersions[path] = (nextPathVersions[path] ?? 0) + 1;
		}
		this.previewPathVersions = nextPathVersions;
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
		this.previewGlobalVersion = 0;
		this.previewPathVersions = {};
	}
}
