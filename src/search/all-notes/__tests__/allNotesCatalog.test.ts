import { TFile, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { CardItem } from "cards/CardItem";
import type { ISortService, SortableItem } from "cards/sorting";
import { createMockTFile } from "testing/__mocks__/testHelpers";
import { createAllNotesCatalog } from "../allNotesCatalog";

type VaultListener = (...args: unknown[]) => void;

interface CatalogHarness {
	readonly app: App;
	readonly sort: ReturnType<typeof vi.fn>;
	readonly getFiles: ReturnType<typeof vi.fn>;
	emit(event: "create" | "delete" | "rename", ...args: unknown[]): void;
	setVaultFiles(files: TFile[]): void;
}

function createHarness(initialFiles: TFile[]): CatalogHarness {
	let vaultFiles = initialFiles;
	const listeners = new Map<string, VaultListener[]>();
	const sort = vi.fn((items: readonly SortableItem[]) => [...items].reverse());
	const getFiles = vi.fn(() => vaultFiles);
	const vault = {
		getFiles,
		on: vi.fn((event: string, listener: VaultListener) => {
			const eventListeners = listeners.get(event) ?? [];
			eventListeners.push(listener);
			listeners.set(event, eventListeners);
			return {};
		}),
	};

	return {
		app: { vault } as unknown as App,
		sort,
		getFiles,
		emit(event, ...args): void {
			for (const listener of listeners.get(event) ?? []) {
				listener(...args);
			}
		},
		setVaultFiles(files): void {
			vaultFiles = files;
		},
	};
}

function getPaths(items: readonly CardItem[]): string[] {
	return items.map((item) => (item.type === "file" ? item.data.path : ""));
}

describe("AllNotesCatalog", () => {
	it("scans lazily and keeps only Markdown and Canvas files", () => {
		const markdown = createMockTFile("notes/a.md");
		const canvas = createMockTFile("boards/b.canvas", "canvas");
		const text = createMockTFile("assets/c.txt", "txt");
		const harness = createHarness([markdown, canvas, text]);
		const catalog = createAllNotesCatalog({
			app: harness.app,
			sortService: { sort: harness.sort } as unknown as ISortService,
			getSortContextVersion: () => 0,
		});

		expect(getPaths(catalog.getItems())).toEqual(["notes/a.md", "boards/b.canvas"]);
	});

	it("reuses the sorted result for the same revision, context, and option", () => {
		const first = createMockTFile("notes/a.md");
		const second = createMockTFile("notes/b.md");
		const harness = createHarness([first, second]);
		let sortContextVersion = 0;
		const catalog = createAllNotesCatalog({
			app: harness.app,
			sortService: { sort: harness.sort } as unknown as ISortService,
			getSortContextVersion: () => sortContextVersion,
		});

		const firstResult = catalog.getSortedItems("alphabetical");
		const cachedResult = catalog.getSortedItems("alphabetical");

		expect(cachedResult).toBe(firstResult);
		expect(harness.sort).toHaveBeenCalledTimes(1);

		sortContextVersion += 1;
		catalog.getSortedItems("alphabetical");
		expect(harness.sort).toHaveBeenCalledTimes(2);
	});

	it("updates incrementally and preserves CardItem identity across rename", () => {
		const first = createMockTFile("notes/a.md");
		const second = createMockTFile("notes/b.md");
		const harness = createHarness([first]);
		const catalog = createAllNotesCatalog({
			app: harness.app,
			sortService: { sort: harness.sort } as unknown as ISortService,
			getSortContextVersion: () => 0,
		});
		const originalItem = catalog.getItems()[0];

		harness.emit("create", second);
		expect(getPaths(catalog.getItems())).toEqual(["notes/a.md", "notes/b.md"]);

		const oldPath = first.path;
		first.path = "archive/a.md";
		first.name = "a.md";
		first.basename = "a";
		harness.emit("rename", first, oldPath);
		expect(catalog.getItems()).toContain(originalItem);
		expect(getPaths(catalog.getItems())).toContain("archive/a.md");

		harness.emit("delete", second);
		expect(getPaths(catalog.getItems())).toEqual(["archive/a.md"]);
		expect(harness.getFiles).toHaveBeenCalledOnce();
	});

	it("handles rename transitions into and out of supported extensions", () => {
		const file = createMockTFile("notes/a.txt", "txt");
		const harness = createHarness([file]);
		const catalog = createAllNotesCatalog({
			app: harness.app,
			sortService: { sort: harness.sort } as unknown as ISortService,
			getSortContextVersion: () => 0,
		});

		expect(catalog.getItems()).toHaveLength(0);
		file.path = "notes/a.md";
		file.extension = "md";
		harness.emit("rename", file, "notes/a.txt");
		expect(getPaths(catalog.getItems())).toEqual(["notes/a.md"]);

		file.path = "notes/a.txt";
		file.extension = "txt";
		harness.emit("rename", file, "notes/a.md");
		expect(catalog.getItems()).toHaveLength(0);
	});

	it("publishes sorting invalidation and recomputes the cached result", () => {
		const harness = createHarness([createMockTFile("notes/a.md")]);
		const catalog = createAllNotesCatalog({
			app: harness.app,
			sortService: { sort: harness.sort } as unknown as ISortService,
			getSortContextVersion: () => 0,
		});
		const listener = vi.fn();
		catalog.subscribe(listener);
		catalog.getSortedItems("alphabetical");

		catalog.invalidateSorting();
		catalog.getSortedItems("alphabetical");

		expect(listener).toHaveBeenCalledWith(1);
		expect(harness.sort).toHaveBeenCalledTimes(2);
	});

	it("rebuilds after a folder rename event", () => {
		const file = createMockTFile("old/a.md");
		const harness = createHarness([file]);
		const catalog = createAllNotesCatalog({
			app: harness.app,
			sortService: { sort: harness.sort } as unknown as ISortService,
			getSortContextVersion: () => 0,
		});
		catalog.getItems();

		file.path = "new/a.md";
		harness.setVaultFiles([file]);
		harness.emit("rename", { path: "new" }, "old");

		expect(getPaths(catalog.getItems())).toEqual(["new/a.md"]);
		expect(harness.getFiles).toHaveBeenCalledTimes(2);
	});
});
