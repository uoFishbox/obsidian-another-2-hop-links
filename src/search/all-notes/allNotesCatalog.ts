import { Component, TFile, type App } from "obsidian";
import { type CardItem } from "cards/CardItem";
import type { ISortService, SortOption } from "cards/sorting";

type CatalogListener = (revision: number) => void;

export interface AllNotesCatalog {
	getRevision(): number;
	getItems(): CardItem[];
	getSortedItems(sortOption: SortOption): CardItem[];
	subscribe(listener: CatalogListener): () => void;
	invalidateSorting(): void;
	destroy(): void;
}

export interface CreateAllNotesCatalogOptions {
	readonly app: App;
	readonly sortService: ISortService;
	readonly getSortContextVersion: () => number;
}

function isNoteFile(file: TFile): boolean {
	const extension = file.extension.toLowerCase();
	return extension === "md" || extension === "canvas";
}

function wasNotePath(path: string): boolean {
	const normalizedPath = path.toLowerCase();
	return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".canvas");
}

/**
 * Creates the plugin-lifetime source and sorted-result cache used by All Notes.
 * Initialization stays lazy so vault scanning does not add work to plugin startup.
 */
export function createAllNotesCatalog(
	options: CreateAllNotesCatalogOptions,
): AllNotesCatalog {
	const { app, sortService, getSortContextVersion } = options;
	const listeners = new Set<CatalogListener>();
	const cardItemByFile = new WeakMap<TFile, CardItem>();
	const indexByPath = new Map<string, number>();
	const sortedItemsByOption = new Map<SortOption, CardItem[]>();
	let files: TFile[] = [];
	let cardItems: CardItem[] = [];
	let component: Component | undefined;
	let initialized = false;
	let revision = 0;
	let cachedSortContextVersion = getSortContextVersion();

	function getCardItem(file: TFile): CardItem {
		const cached = cardItemByFile.get(file);
		if (cached) {
			return cached;
		}

		const item: CardItem = { type: "file", data: file };
		cardItemByFile.set(file, item);
		return item;
	}

	function clearSortedItems(): void {
		sortedItemsByOption.clear();
		cachedSortContextVersion = getSortContextVersion();
	}

	function publish(): void {
		revision += 1;
		clearSortedItems();
		for (const listener of listeners) {
			listener(revision);
		}
	}

	function rebuildFromVault(shouldPublish: boolean): void {
		files = [];
		cardItems = [];
		indexByPath.clear();

		for (const file of app.vault.getFiles()) {
			if (!isNoteFile(file)) {
				continue;
			}

			indexByPath.set(file.path, files.length);
			files.push(file);
			cardItems.push(getCardItem(file));
		}

		if (shouldPublish) {
			publish();
		}
	}

	function addOrReplaceFile(file: TFile): void {
		const existingIndex = indexByPath.get(file.path);
		if (existingIndex !== undefined) {
			if (files[existingIndex] === file) {
				return;
			}

			files[existingIndex] = file;
			cardItems[existingIndex] = getCardItem(file);
			publish();
			return;
		}

		indexByPath.set(file.path, files.length);
		files.push(file);
		cardItems.push(getCardItem(file));
		publish();
	}

	function removePath(path: string): void {
		const removedIndex = indexByPath.get(path);
		if (removedIndex === undefined) {
			return;
		}

		const lastIndex = files.length - 1;
		const lastFile = files[lastIndex];
		files.pop();
		cardItems.pop();
		indexByPath.delete(path);

		if (removedIndex !== lastIndex) {
			files[removedIndex] = lastFile;
			cardItems[removedIndex] = getCardItem(lastFile);
			indexByPath.set(lastFile.path, removedIndex);
		}

		publish();
	}

	function renameFile(file: TFile, oldPath: string): void {
		const wasNote = wasNotePath(oldPath);
		const isNote = isNoteFile(file);

		if (wasNote && !isNote) {
			removePath(oldPath);
			return;
		}

		if (!wasNote && isNote) {
			addOrReplaceFile(file);
			return;
		}

		if (!wasNote) {
			return;
		}

		const existingIndex = indexByPath.get(oldPath);
		if (existingIndex === undefined) {
			addOrReplaceFile(file);
			return;
		}

		indexByPath.delete(oldPath);
		indexByPath.set(file.path, existingIndex);
		files[existingIndex] = file;
		cardItems[existingIndex] = getCardItem(file);
		publish();
	}

	function ensureInitialized(): void {
		if (initialized) {
			return;
		}

		initialized = true;
		rebuildFromVault(false);
		component = new Component();
		component.registerEvent(
			app.vault.on("create", (file) => {
				if (file instanceof TFile && isNoteFile(file)) {
					addOrReplaceFile(file);
				}
			}),
		);
		component.registerEvent(
			app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					removePath(file.path);
				}
			}),
		);
		component.registerEvent(
			app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					renameFile(file, oldPath);
					return;
				}

				// Obsidian may only publish the folder rename while mutating child paths.
				rebuildFromVault(true);
			}),
		);
	}

	function syncSortContext(): void {
		const currentSortContextVersion = getSortContextVersion();
		if (currentSortContextVersion === cachedSortContextVersion) {
			return;
		}

		cachedSortContextVersion = currentSortContextVersion;
		sortedItemsByOption.clear();
	}

	return {
		getRevision(): number {
			ensureInitialized();
			return revision;
		},
		getItems(): CardItem[] {
			ensureInitialized();
			return cardItems;
		},
		getSortedItems(sortOption: SortOption): CardItem[] {
			ensureInitialized();
			syncSortContext();
			const cached = sortedItemsByOption.get(sortOption);
			if (cached) {
				return cached;
			}

			const sortedFiles = sortService.sort(files, sortOption);
			const sortedItems =
				sortedFiles === files
					? cardItems
					: Array.from(sortedFiles, (file) => getCardItem(file));
			sortedItemsByOption.set(sortOption, sortedItems);
			return sortedItems;
		},
		subscribe(listener: CatalogListener): () => void {
			ensureInitialized();
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		invalidateSorting(): void {
			if (!initialized) {
				return;
			}
			publish();
		},
		destroy(): void {
			component?.unload();
			component = undefined;
			listeners.clear();
			sortedItemsByOption.clear();
			indexByPath.clear();
			files = [];
			cardItems = [];
			initialized = false;
		},
	};
}
