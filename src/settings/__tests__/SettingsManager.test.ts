import { describe, expect, it, vi } from "vitest";
import { SettingsManager } from "settings/SettingsManager";

describe("SettingsManager", () => {
	it("normalizes preview activation ahead rows while loading settings", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				previewActivationAheadRows: 2.8,
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings.previewActivationAheadRows).toBe(2);
	});

	it("falls back for invalid preview activation ahead rows", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				previewActivationAheadRows: -1,
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings.previewActivationAheadRows).toBe(1);
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

	it("does not share nested default settings between instances", () => {
		const firstPlugin = {
			loadData: vi.fn(),
			saveData: vi.fn(),
		};
		const secondPlugin = {
			loadData: vi.fn(),
			saveData: vi.fn(),
		};
		const firstManager = new SettingsManager(firstPlugin as never);
		const secondManager = new SettingsManager(secondPlugin as never);

		firstManager.settings.renderCodeBlockTypes.push("mermaid");

		expect(secondManager.settings.renderCodeBlockTypes).toEqual([]);
	});
});
