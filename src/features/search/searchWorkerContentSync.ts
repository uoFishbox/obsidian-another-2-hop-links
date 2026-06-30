import type { SearchContentIndexEntry } from "./fileContentSearchIndex";
import type {
	SearchWorkerFileContentSnapshot,
	SearchWorkerMatchScope,
} from "./searchWorkerTypes";

export interface WorkerFileContentSyncState {
	sessionEnabled: boolean;
	matchScope: SearchWorkerMatchScope;
	query: string;
	contentSyncMode: "eager" | "when-idle" | "progressive";
	progressiveTick: number;
	contentIndexIsLoading: boolean;
}

export function shouldSyncWorkerFileContents(
	state: WorkerFileContentSyncState,
): boolean {
	if (!state.sessionEnabled || state.matchScope !== "title-and-content") {
		return false;
	}

	if (state.contentSyncMode === "progressive") {
		if (!state.query) {
			return false;
		}

		return !state.contentIndexIsLoading || state.progressiveTick > 0;
	}

	if (state.contentSyncMode === "when-idle") {
		return !state.contentIndexIsLoading;
	}

	return true;
}

export interface SearchWorkerFileContentDiff {
	changed: boolean;
	upserts: SearchWorkerFileContentSnapshot[];
	removals: string[];
	nextEntriesByPath: Map<string, Readonly<SearchContentIndexEntry>> | null;
}

export type FileContentEntryVisitor = (
	visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
) => void;

export function diffSearchWorkerFileContentsFromVisitor(
	visitCurrentEntries: FileContentEntryVisitor,
	previousEntriesByPath: ReadonlyMap<string, Readonly<SearchContentIndexEntry>>,
	includeContents: boolean,
): SearchWorkerFileContentDiff {
	if (!includeContents) {
		return diffRemovedFileContentsFromVisitor(
			visitCurrentEntries,
			previousEntriesByPath,
		);
	}

	const seenPaths = new Set<string>();
	const upserts: SearchWorkerFileContentSnapshot[] = [];
	const removals: string[] = [];
	let nextEntriesByPath: Map<string, Readonly<SearchContentIndexEntry>> | null = null;
	const ensureNextEntriesByPath = (): Map<
		string,
		Readonly<SearchContentIndexEntry>
	> => {
		nextEntriesByPath ??= new Map(previousEntriesByPath);
		return nextEntriesByPath;
	};

	visitCurrentEntries((path, entry) => {
		seenPaths.add(path);
		const previousEntry = previousEntriesByPath.get(path);
		if (
			previousEntry?.mtime === entry.mtime &&
			previousEntry.content === entry.content
		) {
			return;
		}

		upserts.push({
			path,
			content: entry.content,
			mtime: entry.mtime,
		});
		ensureNextEntriesByPath().set(path, entry);
	});

	for (const path of previousEntriesByPath.keys()) {
		if (seenPaths.has(path)) {
			continue;
		}

		removals.push(path);
		ensureNextEntriesByPath().delete(path);
	}

	if (upserts.length === 0 && removals.length === 0) {
		return {
			changed: false,
			upserts,
			removals,
			nextEntriesByPath: null,
		};
	}

	return {
		changed: true,
		upserts,
		removals,
		nextEntriesByPath: nextEntriesByPath ?? new Map(),
	};
}

export function diffSearchWorkerFileContents(
	currentEntries: Iterable<readonly [string, Readonly<SearchContentIndexEntry>]>,
	previousEntriesByPath: ReadonlyMap<string, Readonly<SearchContentIndexEntry>>,
	includeContents: boolean,
): SearchWorkerFileContentDiff {
	if (!includeContents) {
		return diffRemovedFileContents(currentEntries, previousEntriesByPath);
	}

	const seenPaths = new Set<string>();
	const upserts: SearchWorkerFileContentSnapshot[] = [];
	const removals: string[] = [];
	let nextEntriesByPath: Map<string, Readonly<SearchContentIndexEntry>> | null = null;
	const ensureNextEntriesByPath = (): Map<
		string,
		Readonly<SearchContentIndexEntry>
	> => {
		nextEntriesByPath ??= new Map(previousEntriesByPath);
		return nextEntriesByPath;
	};

	for (const [path, entry] of currentEntries) {
		seenPaths.add(path);
		const previousEntry = previousEntriesByPath.get(path);
		if (
			previousEntry?.mtime === entry.mtime &&
			previousEntry.content === entry.content
		) {
			continue;
		}

		upserts.push({
			path,
			content: entry.content,
			mtime: entry.mtime,
		});
		ensureNextEntriesByPath().set(path, entry);
	}

	for (const path of previousEntriesByPath.keys()) {
		if (seenPaths.has(path)) {
			continue;
		}

		removals.push(path);
		ensureNextEntriesByPath().delete(path);
	}

	if (upserts.length === 0 && removals.length === 0) {
		return {
			changed: false,
			upserts,
			removals,
			nextEntriesByPath: null,
		};
	}

	return {
		changed: true,
		upserts,
		removals,
		nextEntriesByPath: nextEntriesByPath ?? new Map(),
	};
}

function diffRemovedFileContentsFromVisitor(
	visitCurrentEntries: FileContentEntryVisitor,
	previousEntriesByPath: ReadonlyMap<string, Readonly<SearchContentIndexEntry>>,
): SearchWorkerFileContentDiff {
	const seenPaths = new Set<string>();
	visitCurrentEntries((path) => {
		seenPaths.add(path);
	});

	return buildRemovedFileContentDiff(seenPaths, previousEntriesByPath);
}

function diffRemovedFileContents(
	currentEntries: Iterable<readonly [string, Readonly<SearchContentIndexEntry>]>,
	previousEntriesByPath: ReadonlyMap<string, Readonly<SearchContentIndexEntry>>,
): SearchWorkerFileContentDiff {
	const seenPaths = new Set<string>();
	for (const [path] of currentEntries) {
		seenPaths.add(path);
	}

	return buildRemovedFileContentDiff(seenPaths, previousEntriesByPath);
}

function buildRemovedFileContentDiff(
	seenPaths: ReadonlySet<string>,
	previousEntriesByPath: ReadonlyMap<string, Readonly<SearchContentIndexEntry>>,
): SearchWorkerFileContentDiff {
	const removals: string[] = [];
	let nextEntriesByPath: Map<string, Readonly<SearchContentIndexEntry>> | null = null;

	for (const path of previousEntriesByPath.keys()) {
		if (seenPaths.has(path)) {
			continue;
		}

		removals.push(path);
		nextEntriesByPath ??= new Map(previousEntriesByPath);
		nextEntriesByPath.delete(path);
	}

	if (removals.length === 0) {
		return {
			changed: false,
			upserts: [],
			removals,
			nextEntriesByPath: null,
		};
	}

	return {
		changed: true,
		upserts: [],
		removals,
		nextEntriesByPath: nextEntriesByPath ?? new Map(),
	};
}
