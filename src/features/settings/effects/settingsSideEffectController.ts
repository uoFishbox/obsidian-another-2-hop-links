import type { Workspace } from "obsidian";
import {
	applySettingsSideEffects,
	type SettingsSideEffectHandlers,
} from "./settingsSideEffects";
import type { PluginSettings } from "features/settings/model";
import type { IndexingService } from "core/indexing/index-service/IndexingService";
import type { SortService } from "core/sorting/SortService";
import type { DisplayModeController } from "features/display-mode/DisplayModeController";
import type { EmptyViewController } from "infrastructure/lifecycle/emptyViewController";
import type { ViewUpdateOrchestrator } from "infrastructure/lifecycle/viewUpdateOrchestrator";
import { TWO_HOP_LINKS_VIEW_TYPE } from "features/two-hop/ui/TwoHopLinksView";
import { VIEW_TYPE_TAG_NOTES } from "features/tag-notes/ui/TagNotesView";
import { VIEW_TYPE_PRE_CREATE } from "features/pre-creation/ui/PreCreationView";

/**
 * View types whose layouts are affected by LAYOUT_AFFECTING_SETTINGS.
 * Each view exposes `refreshFromSettings()` to re-render with new settings.
 */
const LAYOUT_REFRESHABLE_VIEW_TYPES: ReadonlyArray<string> = [
	TWO_HOP_LINKS_VIEW_TYPE,
	VIEW_TYPE_TAG_NOTES,
	VIEW_TYPE_PRE_CREATE,
];

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
	readonly indexingService: IndexingService;
	readonly workspace: Workspace;
	readonly bumpSortContextVersion: () => void;
	readonly setLoggingEnabled: (enabled: boolean) => void;
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

	function buildHandlers(): SettingsSideEffectHandlers {
		return {
			setLoggingEnabled: (enabled) => {
				deps.setLoggingEnabled(enabled);
			},
			updateDecoratedViews: () => {
				deps.viewUpdateOrchestrator.updateAllViews();
			},
			syncEmptyView: () => {
				deps.emptyViewController.sync();
			},
			syncTagFeatureSettings: () => {
				deps.indexingService.invalidateAll();
				void deps.indexingService
					.enqueueRebuild("settings-change")
					.catch((error) => {
						console.error(
							"[Cosense card links] Failed to rebuild indexes after tag feature change:",
							error,
						);
					});
			},
			invalidateSortCache: () => {
				deps.sortService.invalidateCache();
				deps.bumpSortContextVersion();
			},
			handleDisplayModeSettingsChange: () => {
				deps.displayModeManager.handleSettingsChange();
			},
			refreshLayoutAffectedViews: () => {
				refreshLayoutAffectedViews();
			},
		};
	}

	function apply(
		changedKeys: Iterable<keyof PluginSettings>,
		settings: PluginSettings,
	): void {
		applySettingsSideEffects(changedKeys, settings, buildHandlers());
	}

	return {
		apply,
		refreshLayoutAffectedViews,
	};
}
