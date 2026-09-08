import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "settings/model";
import { SettingsManager } from "settings/persistence/SettingsManager";

describe("SettingsManager", () => {
	it("drops obsolete internal tuning settings while loading", async () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			loadData: vi.fn().mockResolvedValue({
				previewActivationAheadRows: 2.8,
				previewDomCommitsPerSecond: 40.8,
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin);

		await manager.load();

		expect(plugin.settings).not.toHaveProperty("previewActivationAheadRows");
		expect(plugin.settings).not.toHaveProperty("previewDomCommitsPerSecond");
	});

	it("ignores unknown keys while loading settings", async () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			loadData: vi.fn().mockResolvedValue({
				obsoleteSetting: { retained: false },
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin);

		await manager.load();

		expect(plugin.settings).not.toHaveProperty("obsoleteSetting");
	});

	it("replaces the authoritative settings object on update", async () => {
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			loadData: vi.fn(),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin);
		const previous = plugin.settings;

		await manager.update("language", "ja", { immediate: true });

		expect(plugin.settings).not.toBe(previous);
		expect(plugin.settings.language).toBe("ja");
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
	});
});
