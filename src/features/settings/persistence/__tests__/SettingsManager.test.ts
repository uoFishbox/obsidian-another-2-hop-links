import { describe, expect, it, vi } from "vitest";
import { SettingsManager } from "features/settings/persistence/SettingsManager";
import { resolvePreviewActivationsPerSecond } from "appConstants";

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

	it("normalizes preview scheduling rates while loading settings", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				previewDomCommitsPerSecond: 40.8,
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings.previewDomCommitsPerSecond).toBe(40);
		expect(
			resolvePreviewActivationsPerSecond(
				manager.settings.previewDomCommitsPerSecond,
			),
		).toBe(32);
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

	it("loads without throwing when renderCodeBlockTypes is corrupt", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				renderCodeBlockTypes: 123,
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings.renderCodeBlockTypes).toEqual([]);
		expect(Object.isFrozen(manager.settings)).toBe(true);
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

		expect(() =>
			firstManager.settings.renderCodeBlockTypes.push("mermaid"),
		).toThrow();
		expect(secondManager.settings.renderCodeBlockTypes).toEqual([]);
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
