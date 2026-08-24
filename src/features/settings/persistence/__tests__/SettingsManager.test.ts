import { describe, expect, it, vi } from "vitest";
import { SettingsManager } from "features/settings/persistence/SettingsManager";

describe("SettingsManager", () => {
	it("drops obsolete internal tuning settings while loading", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				previewActivationAheadRows: 2.8,
				previewDomCommitsPerSecond: 40.8,
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings).not.toHaveProperty("previewActivationAheadRows");
		expect(manager.settings).not.toHaveProperty("previewDomCommitsPerSecond");
	});

	it("ignores unknown keys while loading settings", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				obsoleteSetting: { retained: false },
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings).not.toHaveProperty("obsoleteSetting");
	});

	it("replaces the authoritative settings object on update", async () => {
		const plugin = {
			loadData: vi.fn(),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);
		const previous = manager.settings;

		await manager.update("language", "ja", { immediate: true });

		expect(manager.settings).not.toBe(previous);
		expect(manager.settings.language).toBe("ja");
		expect(plugin.saveData).toHaveBeenCalledWith(manager.settings);
	});
});
