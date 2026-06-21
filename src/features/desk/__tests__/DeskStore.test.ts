import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeskStore } from "features/desk/DeskStore";
import type { DeskState } from "features/desk/types";
import type { PluginSettings } from "types/settings";

function createStore(initial: DeskState = { version: 1, cards: [] }) {
	const settings = {
		desk: initial,
	} as PluginSettings;
	const update = vi.fn(
		async (key: keyof PluginSettings, value: PluginSettings[typeof key]) => {
			settings[key] = value as never;
		},
	);
	const plugin = {
		settings,
		settingsManager: {
			update,
		},
	};

	return {
		store: new DeskStore(plugin as never),
		settings,
		update,
	};
}

describe("DeskStore", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
	});

	it("adds a new path to the end", async () => {
		const { store, settings } = createStore();

		await store.addOrMovePath("Notes/A.md");

		expect(settings.desk.cards).toEqual([
			{
				path: "Notes/A.md",
				addedAt: Date.now(),
				updatedAt: Date.now(),
			},
		]);
	});

	it("inserts a new path at the requested index", async () => {
		const { store, settings } = createStore({
			version: 1,
			cards: [
				{ path: "Notes/A.md", addedAt: 1, updatedAt: 1 },
				{ path: "Notes/C.md", addedAt: 3, updatedAt: 3 },
			],
		});

		await store.addOrMovePath("Notes/B.md", 1);

		expect(settings.desk.cards.map((card) => card.path)).toEqual([
			"Notes/A.md",
			"Notes/B.md",
			"Notes/C.md",
		]);
	});

	it("moves an existing path without duplicating it", async () => {
		const { store, settings } = createStore({
			version: 1,
			cards: [
				{ path: "Notes/A.md", addedAt: 1, updatedAt: 1 },
				{ path: "Notes/B.md", addedAt: 2, updatedAt: 2 },
				{ path: "Notes/C.md", addedAt: 3, updatedAt: 3 },
			],
		});

		await store.addOrMovePath("Notes/A.md", 2);

		expect(settings.desk.cards.map((card) => card.path)).toEqual([
			"Notes/B.md",
			"Notes/C.md",
			"Notes/A.md",
		]);
		expect(settings.desk.cards[2].addedAt).toBe(1);
		expect(settings.desk.cards[2].updatedAt).toBe(Date.now());
	});

	it("places a path at a free grid position", async () => {
		const { store, settings } = createStore({
			version: 1,
			cards: [{ path: "Notes/A.md", addedAt: 1, updatedAt: 1 }],
		});

		await store.placePath("Notes/A.md", { column: 2, row: 3 });

		expect(settings.desk.cards).toEqual([
			{
				path: "Notes/A.md",
				addedAt: 1,
				updatedAt: Date.now(),
				gridPosition: { column: 2, row: 3 },
			},
		]);
	});

	it("places a path and moves the occupant in one save", async () => {
		const { store, settings, update } = createStore({
			version: 1,
			cards: [
				{
					path: "Notes/A.md",
					addedAt: 1,
					updatedAt: 1,
					gridPosition: { column: 0, row: 0 },
				},
				{
					path: "Notes/B.md",
					addedAt: 2,
					updatedAt: 2,
					gridPosition: { column: 1, row: 0 },
				},
			],
		});

		await store.placePathAndMoveOccupant(
			"Notes/A.md",
			{ column: 1, row: 0 },
			"Notes/B.md",
			{ column: 0, row: 0 },
		);

		expect(update).toHaveBeenCalledTimes(1);
		expect(settings.desk.cards).toEqual([
			{
				path: "Notes/A.md",
				addedAt: 1,
				updatedAt: Date.now(),
				gridPosition: { column: 1, row: 0 },
			},
			{
				path: "Notes/B.md",
				addedAt: 2,
				updatedAt: Date.now(),
				gridPosition: { column: 0, row: 0 },
			},
		]);
	});

	it("removes a path", async () => {
		const { store, settings } = createStore({
			version: 1,
			cards: [
				{ path: "Notes/A.md", addedAt: 1, updatedAt: 1 },
				{ path: "Notes/B.md", addedAt: 2, updatedAt: 2 },
			],
		});

		await store.removePath("Notes/A.md");

		expect(settings.desk.cards.map((card) => card.path)).toEqual([
			"Notes/B.md",
		]);
	});

	it("updates a path on rename", async () => {
		const { store, settings } = createStore({
			version: 1,
			cards: [{ path: "Notes/A.md", addedAt: 1, updatedAt: 1 }],
		});

		await store.handleRename("Notes/A.md", "Notes/Renamed.md");

		expect(settings.desk.cards).toEqual([
			{
				path: "Notes/Renamed.md",
				addedAt: 1,
				updatedAt: Date.now(),
			},
		]);
	});

	it("notifies subscribers after saving", async () => {
		const { store } = createStore();
		const listener = vi.fn();

		store.subscribe(listener);
		await store.addOrMovePath("Notes/A.md");

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith({
			version: 1,
			cards: [
				{
					path: "Notes/A.md",
					addedAt: Date.now(),
					updatedAt: Date.now(),
				},
			],
		});
	});
});
