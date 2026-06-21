import {
	CARD_LAYOUT_SETTING_KEYS,
	type PluginSettings,
} from "types/settings";

export const LAYOUT_AFFECTING_SETTINGS = new Set<keyof PluginSettings>([
	...CARD_LAYOUT_SETTING_KEYS,
	"enableTagFeatures",
]);

/**
 * Settings whose changes are scoped to an already-mounted view and must not
 * trigger a display-mode reactivation. Reactivating the display mode strategy
 * force-remounts inline Svelte components, which destroys their local state
 * (e.g. the search input value held by `useSearchQuery`). The full-text search
 * toggle only affects in-view filtering, so it must be excluded here.
 */
const DISPLAY_MODE_REACTIVATION_EXCLUDED_SETTINGS = new Set<
	keyof PluginSettings
>(["enableContentSearch"]);

export interface SettingsSideEffectHandlers {
	setLoggingEnabled(enabled: boolean): void;
	updateDecoratedViews(): void;
	syncEmptyView(): void;
	syncTagFeatureSettings(): void;
	invalidateSortCache(): void;
	handleDisplayModeSettingsChange(): void;
	refreshLayoutAffectedViews(): void;
}

export function applySettingsSideEffects(
	changedKeys: Iterable<keyof PluginSettings>,
	settings: PluginSettings,
	handlers: SettingsSideEffectHandlers,
): void {
	const changedKeySet = new Set(changedKeys);
	if (changedKeySet.size === 0) {
		return;
	}

	if (changedKeySet.has("enableLogging")) {
		handlers.setLoggingEnabled(settings.enableLogging);
	}

	if (changedKeySet.has("enableUnresolvedLinkDecoration")) {
		handlers.updateDecoratedViews();
	}

	if (changedKeySet.has("enableEmptyViewAllNotesInNewTab")) {
		handlers.syncEmptyView();
	}

	if (changedKeySet.has("enableTagFeatures")) {
		handlers.syncTagFeatureSettings();
	}

	const hasGeneralSettingsChange = Array.from(changedKeySet).some(
		(key) => key !== "lastUsedSortOption",
	);
	if (hasGeneralSettingsChange) {
		handlers.invalidateSortCache();

		const shouldReactivateDisplayMode = Array.from(changedKeySet).some(
			(key) =>
				!DISPLAY_MODE_REACTIVATION_EXCLUDED_SETTINGS.has(key) &&
				key !== "lastUsedSortOption",
		);
		if (shouldReactivateDisplayMode) {
			handlers.handleDisplayModeSettingsChange();
		}
	}

	const shouldRefreshLayout = Array.from(changedKeySet).some((key) =>
		LAYOUT_AFFECTING_SETTINGS.has(key),
	);
	if (shouldRefreshLayout) {
		handlers.refreshLayoutAffectedViews();
	}
}
