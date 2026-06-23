import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type PluginSettings } from "types/settings";
import {
	applySettingsSideEffects,
	type SettingsSideEffectHandlers,
} from "settings/settingsSideEffects";

function createHandlers() {
	const handlers: SettingsSideEffectHandlers = {
		setLoggingEnabled: vi.fn(),
		updateDecoratedViews: vi.fn(),
		syncEmptyView: vi.fn(),
		syncTagFeatureSettings: vi.fn(),
		invalidateSortCache: vi.fn(),
		handleDisplayModeSettingsChange: vi.fn(),
		refreshLayoutAffectedViews: vi.fn(),
	};

	return handlers;
}

function summarizeHandlers(handlers: SettingsSideEffectHandlers) {
	return {
		setLoggingEnabled: (handlers.setLoggingEnabled as ReturnType<typeof vi.fn>).mock
			.calls,
		updateDecoratedViews: (
			handlers.updateDecoratedViews as ReturnType<typeof vi.fn>
		).mock.calls.length,
		syncEmptyView: (handlers.syncEmptyView as ReturnType<typeof vi.fn>).mock.calls
			.length,
		syncTagFeatureSettings: (
			handlers.syncTagFeatureSettings as ReturnType<typeof vi.fn>
		).mock.calls.length,
		invalidateSortCache: (handlers.invalidateSortCache as ReturnType<typeof vi.fn>)
			.mock.calls.length,
		handleDisplayModeSettingsChange: (
			handlers.handleDisplayModeSettingsChange as ReturnType<typeof vi.fn>
		).mock.calls.length,
		refreshLayoutAffectedViews: (
			handlers.refreshLayoutAffectedViews as ReturnType<typeof vi.fn>
		).mock.calls.length,
	};
}

function applySingleKey(
	key: keyof PluginSettings,
	settings: PluginSettings,
): ReturnType<typeof summarizeHandlers> {
	const handlers = createHandlers();
	applySettingsSideEffects([key], settings, handlers);
	return summarizeHandlers(handlers);
}

function applyBatchKey(
	key: keyof PluginSettings,
	settings: PluginSettings,
): ReturnType<typeof summarizeHandlers> {
	const handlers = createHandlers();
	applySettingsSideEffects(
		Object.keys({ [key]: settings[key] }) as Array<keyof PluginSettings>,
		settings,
		handlers,
	);
	return summarizeHandlers(handlers);
}

describe("applySettingsSideEffects", () => {
	it("treats single-key and batch updates equivalently for enableLogging", () => {
		expect(applySingleKey("enableLogging", DEFAULT_SETTINGS)).toEqual(
			applyBatchKey("enableLogging", DEFAULT_SETTINGS),
		);
	});

	it("refreshes decorated views for unresolved link decoration updates", () => {
		const handlers = createHandlers();
		applySettingsSideEffects(
			["enableUnresolvedLinkDecoration"],
			DEFAULT_SETTINGS,
			handlers,
		);

		expect(handlers.updateDecoratedViews).toHaveBeenCalledTimes(1);
		expect(handlers.invalidateSortCache).toHaveBeenCalledTimes(1);
		expect(handlers.handleDisplayModeSettingsChange).toHaveBeenCalledTimes(1);
	});

	it("syncs the empty view toggle update", () => {
		const handlers = createHandlers();
		applySettingsSideEffects(
			["enableEmptyViewAllNotesInNewTab"],
			DEFAULT_SETTINGS,
			handlers,
		);

		expect(handlers.syncEmptyView).toHaveBeenCalledTimes(1);
		expect(handlers.invalidateSortCache).toHaveBeenCalledTimes(1);
	});

	it("refreshes layout-affected views for card width updates", () => {
		const handlers = createHandlers();
		applySettingsSideEffects(["cardWidthPx"], DEFAULT_SETTINGS, handlers);

		expect(handlers.refreshLayoutAffectedViews).toHaveBeenCalledTimes(1);
		expect(handlers.invalidateSortCache).toHaveBeenCalledTimes(1);
	});

	it("skips global refresh work for last used sort option updates", () => {
		const handlers = createHandlers();
		applySettingsSideEffects(["lastUsedSortOption"], DEFAULT_SETTINGS, handlers);

		expect(handlers.setLoggingEnabled).not.toHaveBeenCalled();
		expect(handlers.updateDecoratedViews).not.toHaveBeenCalled();
		expect(handlers.syncEmptyView).not.toHaveBeenCalled();
		expect(handlers.syncTagFeatureSettings).not.toHaveBeenCalled();
		expect(handlers.invalidateSortCache).not.toHaveBeenCalled();
		expect(handlers.handleDisplayModeSettingsChange).not.toHaveBeenCalled();
		expect(handlers.refreshLayoutAffectedViews).not.toHaveBeenCalled();
	});

	it("does not reactivate display mode for full-text search toggle", () => {
		const handlers = createHandlers();
		applySettingsSideEffects(["enableContentSearch"], DEFAULT_SETTINGS, handlers);

		// The toggle only affects in-view filtering; it must not force-remount
		// the inline Svelte components (which would discard the search input).
		expect(handlers.handleDisplayModeSettingsChange).not.toHaveBeenCalled();
		expect(handlers.refreshLayoutAffectedViews).not.toHaveBeenCalled();
		expect(handlers.invalidateSortCache).toHaveBeenCalledTimes(1);
	});

	it("syncs tag feature state changes", () => {
		const handlers = createHandlers();
		applySettingsSideEffects(["enableTagFeatures"], DEFAULT_SETTINGS, handlers);

		expect(handlers.syncTagFeatureSettings).toHaveBeenCalledTimes(1);
		expect(handlers.invalidateSortCache).toHaveBeenCalledTimes(1);
		expect(handlers.refreshLayoutAffectedViews).toHaveBeenCalledTimes(1);
	});
});
