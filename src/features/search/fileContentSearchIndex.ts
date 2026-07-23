import type { TFile } from "obsidian";

export interface SearchContentIndexEntry {
	content: string;
	mtime: number;
}

export interface ReconciledFileContentIndex {
	nextIndex: Map<string, SearchContentIndexEntry>;
	filesToLoad: TFile[];
	activePaths: Set<string>;
}

export function reconcileFileContentIndex(
	searchableFiles: readonly TFile[],
	currentIndex: ReadonlyMap<string, SearchContentIndexEntry>,
): ReconciledFileContentIndex {
	const nextIndex = new Map<string, SearchContentIndexEntry>();
	const filesToLoad: TFile[] = [];
	const activePaths = new Set<string>();

	for (const file of searchableFiles) {
		const path = file.path;
		activePaths.add(path);

		const currentEntry = currentIndex.get(path);
		if (currentEntry && currentEntry.mtime === file.stat.mtime) {
			nextIndex.set(path, currentEntry);
			continue;
		}

		filesToLoad.push(file);
	}

	return {
		nextIndex,
		filesToLoad,
		activePaths,
	};
}

export function applyLoadedFileContentEntry(
	index: Map<string, SearchContentIndexEntry>,
	path: string,
	entry: SearchContentIndexEntry,
): void {
	const existing = index.get(path);
	if (!existing || existing.mtime <= entry.mtime) {
		index.set(path, entry);
	}
}
