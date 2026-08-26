import type { Workspace } from "obsidian";
import { CARD_LAYOUT_SETTING_KEYS, type PluginSettings } from "settings/model";
import type { IndexingService } from "indexing/index-service/IndexingService";
import type { SortService } from "cards/sorting/SortService";
import type { DisplayModeController } from "two-hop/display/DisplayModeController";
import type { EmptyViewController } from "obsidian-integration/lifecycle/emptyViewController";
import type { ViewUpdateOrchestrator } from "obsidian-integration/lifecycle/viewUpdateOrchestrator";
/**
 * View types whose layouts are affected by LAYOUT_AFFECTING_SETTINGS.
 * Each view exposes `refreshFromSettings()` to re-render with new settings.
 */
const LAYOUT_REFRESHABLE_VIEW_TYPES: ReadonlyArray<string> = [
	"cosense-card-links-all-notes-view",
	"cosense-card-links-view",
	"cosense-card-links-tag-notes-view",
	"cosense-card-links-pre-create-view",
];

const LAYOUT_AFFECTING_SETTINGS = new Set<keyof PluginSettings>([
	...CARD_LAYOUT_SETTING_KEYS,
	"enableTagFeatures",
]);

interface RefreshableFromSettings {
	refreshFromSettings(): void;
}

function isRefreshableFromSettings(view: unknown): view is RefreshableFromSettings {
	if (typeof view !== "object" || view === null) return false;
	return (
		typeof (view as { refreshFromSettings?: unknown }).refreshFromSettings ===
		"function"
	);
}

export interface SettingsSideEffectControllerDeps {
	readonly viewUpdateOrchestrator: ViewUpdateOrchestrator;
	readonly emptyViewController: EmptyViewController;
	readonly displayModeManager: DisplayModeController;
	readonly sortService: SortService;
	readonly invalidateAllNotesSorting: () => void;
	readonly indexingService: IndexingService;
	readonly workspace: Workspace;
	readonly bumpSortContextVersion: () => void;
}

export interface SettingsSideEffectController {
	apply(changedKeys: Iterable<keyof PluginSettings>, settings: PluginSettings): void;
	refreshLayoutAffectedViews(): void;
}

/**
 * Encapsulates the imperative side effects triggered by setting changes,
 * keeping the plugin entry point free from handler wiring and view-type loops.
 */
export function createSettingsSideEffectController(
	deps: SettingsSideEffectControllerDeps,
): SettingsSideEffectController {
	function refreshLayoutAffectedViews(): void {
		for (const viewType of LAYOUT_REFRESHABLE_VIEW_TYPES) {
			for (const leaf of deps.workspace.getLeavesOfType(viewType)) {
				if (isRefreshableFromSettings(leaf.view)) {
					leaf.view.refreshFromSettings();
				}
			}
		}

		deps.emptyViewController.refresh();
	}

	function apply(
		changedKeys: Iterable<keyof PluginSettings>,
		settings: PluginSettings,
	): void {
		const changedKeySet = new Set(changedKeys);
		if (changedKeySet.size === 0) {
			return;
		}

		if (changedKeySet.has("enableUnresolvedLinkDecoration")) {
			deps.viewUpdateOrchestrator.updateAllViews();
		}
		if (changedKeySet.has("enableEmptyViewAllNotesInNewTab")) {
			deps.emptyViewController.sync();
		}
		if (changedKeySet.has("enableTagFeatures")) {
			deps.indexingService.invalidateAll();
			void deps.indexingService
				.enqueueRebuild("settings-change")
				.catch((error) => {
					console.error(
						"[Cosense card links] Failed to rebuild indexes after tag feature change:",
						error,
					);
				});
		}

		let invalidatesSort = false;
		let reactivatesDisplayMode = false;
		let refreshesLayout = false;
		for (const key of changedKeySet) {
			if (key !== "lastUsedSortOption") {
				invalidatesSort = true;
				if (key !== "enableContentSearch") {
					reactivatesDisplayMode = true;
				}
			}
			if (LAYOUT_AFFECTING_SETTINGS.has(key)) {
				refreshesLayout = true;
			}
		}

		if (invalidatesSort) {
			deps.sortService.invalidateCache();
			deps.bumpSortContextVersion();
			deps.invalidateAllNotesSorting();
		}
		if (reactivatesDisplayMode) {
			deps.displayModeManager.handleSettingsChange();
		}
		if (refreshesLayout) {
			refreshLayoutAffectedViews();
		}
	}

	return {
		apply,
		refreshLayoutAffectedViews,
	};
}
