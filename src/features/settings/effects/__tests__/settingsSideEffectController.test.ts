import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type PluginSettings } from "features/settings/model";
import { createSettingsSideEffectController } from "../settingsSideEffectController";

function createHarness() {
	const mocks = {
		updateAllViews: vi.fn(),
		syncEmptyView: vi.fn(),
		refreshEmptyView: vi.fn(),
		handleSettingsChange: vi.fn(),
		invalidateSortCache: vi.fn(),
		invalidateAll: vi.fn(),
		enqueueRebuild: vi.fn(() => Promise.resolve()),
		getLeavesOfType: vi.fn(() => []),
		bumpSortContextVersion: vi.fn(),
		setLoggingEnabled: vi.fn(),
	};
	const controller = createSettingsSideEffectController({
		viewUpdateOrchestrator: {
			updateAllViews: mocks.updateAllViews,
		} as never,
		emptyViewController: {
			sync: mocks.syncEmptyView,
			refresh: mocks.refreshEmptyView,
		} as never,
		displayModeManager: {
			handleSettingsChange: mocks.handleSettingsChange,
		} as never,
		sortService: {
			invalidateCache: mocks.invalidateSortCache,
		} as never,
		indexingService: {
			invalidateAll: mocks.invalidateAll,
			enqueueRebuild: mocks.enqueueRebuild,
		} as never,
		workspace: {
			getLeavesOfType: mocks.getLeavesOfType,
		} as never,
		bumpSortContextVersion: mocks.bumpSortContextVersion,
		setLoggingEnabled: mocks.setLoggingEnabled,
	});

	return {
		apply: (...keys: Array<keyof PluginSettings>) =>
			controller.apply(keys, DEFAULT_SETTINGS),
		mocks,
	};
}

describe("SettingsSideEffectController", () => {
	it("updates decorated views and general caches", () => {
		const { apply, mocks } = createHarness();

		apply("enableUnresolvedLinkDecoration");

		expect(mocks.updateAllViews).toHaveBeenCalledOnce();
		expect(mocks.invalidateSortCache).toHaveBeenCalledOnce();
		expect(mocks.bumpSortContextVersion).toHaveBeenCalledOnce();
		expect(mocks.handleSettingsChange).toHaveBeenCalledOnce();
	});

	it("syncs the empty view toggle", () => {
		const { apply, mocks } = createHarness();

		apply("enableEmptyViewAllNotesInNewTab");

		expect(mocks.syncEmptyView).toHaveBeenCalledOnce();
		expect(mocks.invalidateSortCache).toHaveBeenCalledOnce();
	});

	it("refreshes layout-affected views", () => {
		const { apply, mocks } = createHarness();

		apply("cardWidthPx");

		expect(mocks.getLeavesOfType).toHaveBeenCalledTimes(4);
		expect(mocks.refreshEmptyView).toHaveBeenCalledOnce();
	});

	it("skips global work for the persisted sort option", () => {
		const { apply, mocks } = createHarness();

		apply("lastUsedSortOption");

		expect(mocks.invalidateSortCache).not.toHaveBeenCalled();
		expect(mocks.handleSettingsChange).not.toHaveBeenCalled();
		expect(mocks.refreshEmptyView).not.toHaveBeenCalled();
	});

	it("does not reactivate display mode for content search", () => {
		const { apply, mocks } = createHarness();

		apply("enableContentSearch");

		expect(mocks.invalidateSortCache).toHaveBeenCalledOnce();
		expect(mocks.handleSettingsChange).not.toHaveBeenCalled();
		expect(mocks.refreshEmptyView).not.toHaveBeenCalled();
	});

	it("rebuilds indexes and refreshes layout for tag feature changes", () => {
		const { apply, mocks } = createHarness();

		apply("enableTagFeatures");

		expect(mocks.invalidateAll).toHaveBeenCalledOnce();
		expect(mocks.enqueueRebuild).toHaveBeenCalledWith("settings-change");
		expect(mocks.invalidateSortCache).toHaveBeenCalledOnce();
		expect(mocks.refreshEmptyView).toHaveBeenCalledOnce();
	});

	it("uses the final settings once for a batch", () => {
		const { apply, mocks } = createHarness();

		apply("enableLogging", "enableUnresolvedLinkDecoration");

		expect(mocks.setLoggingEnabled).toHaveBeenCalledWith(
			DEFAULT_SETTINGS.enableLogging,
		);
		expect(mocks.invalidateSortCache).toHaveBeenCalledOnce();
		expect(mocks.handleSettingsChange).toHaveBeenCalledOnce();
	});
});
