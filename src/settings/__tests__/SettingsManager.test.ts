import { describe, expect, it, vi } from "vitest";
import { SettingsManager } from "settings/SettingsManager";

describe("SettingsManager", () => {
	it("normalizes desk cards while loading settings", async () => {
		const plugin = {
			loadData: vi.fn().mockResolvedValue({
				desk: {
					version: 1,
					cards: [
						{ path: "Notes/A.md", addedAt: 1, updatedAt: 2 },
						{ path: "Notes/A.md", addedAt: 3, updatedAt: 4 },
						{ path: "", addedAt: 5, updatedAt: 6 },
						{
							path: "Notes/B.md",
							gridPosition: { column: 2.9, row: 3.1 },
						},
						{ path: "Notes/C.md", gridPosition: { column: -1, row: 0 } },
						null,
					],
				},
			}),
			saveData: vi.fn(),
		};
		const manager = new SettingsManager(plugin as never);

		await manager.load();

		expect(manager.settings.desk.version).toBe(1);
		expect(manager.settings.desk.cards).toEqual([
			{ path: "Notes/A.md", addedAt: 1, updatedAt: 2 },
			{
				path: "Notes/B.md",
				addedAt: expect.any(Number),
				updatedAt: expect.any(Number),
				gridPosition: { column: 2, row: 3 },
			},
			{
				path: "Notes/C.md",
				addedAt: expect.any(Number),
				updatedAt: expect.any(Number),
			},
		]);
	});

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

		firstManager.settings.desk.cards.push({
			path: "Notes/A.md",
			addedAt: 1,
			updatedAt: 2,
		});
		firstManager.settings.renderCodeBlockTypes.push("mermaid");

		expect(secondManager.settings.desk.cards).toEqual([]);
		expect(secondManager.settings.renderCodeBlockTypes).toEqual([]);
	});
});
