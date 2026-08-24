import { TFile, type App, type Pos, type Vault } from "obsidian";
import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { getFileContent } from "preview/pipeline/previewContent";
import { yieldToMainThreadIdleAware } from "indexing/timeSlicing";
import { getFileContentVaultEventHub } from "./fileContentVaultEventHub";
import { getSearchQueryTerms } from "./searchQueryTerms";

export interface SearchContentIndexEntry {
	/** Lowercase content used directly for case-insensitive search. */
	content: string;
	mtime: number;
}

export interface ReconciledFileContentIndex {
	filesToLoad: TFile[];
	activePaths: Set<string>;
}

export function reconcileFileContentIndex(
	searchableFiles: readonly TFile[],
	currentIndex: Map<string, SearchContentIndexEntry>,
): ReconciledFileContentIndex {
	const filesToLoad: TFile[] = [];
	const activePaths = new Set<string>();

	for (const file of searchableFiles) {
		activePaths.add(file.path);
	}

	for (const path of currentIndex.keys()) {
		if (!activePaths.has(path)) {
			currentIndex.delete(path);
		}
	}

	for (const file of searchableFiles) {
		const currentEntry = currentIndex.get(file.path);
		if (currentEntry && currentEntry.mtime === file.stat.mtime) {
			continue;
		}

		// Do not expose content from an older mtime while the replacement loads.
		currentIndex.delete(file.path);
		filesToLoad.push(file);
	}

	return { filesToLoad, activePaths };
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

export interface FileContentIndexResult {
	isLoading(): boolean;
	getFirstMatchPosition(
		query: string,
		targetFile: TFile | null | undefined,
	): Pos | undefined;
	forEachEntry(
		visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
	): void;
}

export interface UseFileContentIndexOptions {
	enabled?: boolean | (() => boolean);
}

type PositionCache = {
	queryKey: string;
	position: Pos | undefined;
};

async function loadFileContentEntry(
	targetFile: TFile,
	vault: Vault,
): Promise<{ path: string; entry: SearchContentIndexEntry }> {
	const mtime = targetFile.stat.mtime;
	try {
		const content = await getFileContent(targetFile, vault);
		return {
			path: targetFile.path,
			entry: { content: content.toLowerCase(), mtime },
		};
	} catch {
		return { path: targetFile.path, entry: { content: "", mtime } };
	}
}

export function useFileContentIndex(
	app: App,
	getSearchableFiles: () => readonly TFile[],
	options: UseFileContentIndexOptions = {},
): FileContentIndexResult {
	const { enabled = true } = options;
	const isEnabled = (): boolean =>
		typeof enabled === "function" ? enabled() : enabled;
	const fileContentIndex = new SvelteMap<string, SearchContentIndexEntry>();
	const indexedContentActivePaths = new SvelteSet<string>();
	const firstMatchPositionCacheByEntry = new WeakMap<
		SearchContentIndexEntry,
		PositionCache
	>();
	let contentIndexRefreshNonce = $state(0);
	let isLoading = $state(false);

	const CONTENT_LOAD_BATCH_SIZE = 10;

	$effect(() => {
		const enabledNow = isEnabled();

		if (!enabledNow) {
			isLoading = false;
			fileContentIndex.clear();
			indexedContentActivePaths.clear();
			return;
		}

		let canceled = false;
		void contentIndexRefreshNonce; // 依存関係に登録

		const searchableFiles = getSearchableFiles();
		const { filesToLoad, activePaths } = untrack(() =>
			reconcileFileContentIndex(searchableFiles, fileContentIndex),
		);

		replaceActivePaths(indexedContentActivePaths, activePaths);

		isLoading = filesToLoad.length > 0;

		if (filesToLoad.length === 0) {
			return;
		}

		void (async () => {
			for (
				let i = 0;
				i < filesToLoad.length && !canceled;
				i += CONTENT_LOAD_BATCH_SIZE
			) {
				const promises: Array<
					Promise<{ path: string; entry: SearchContentIndexEntry }>
				> = [];
				const end = Math.min(i + CONTENT_LOAD_BATCH_SIZE, filesToLoad.length);

				for (let j = i; j < end; j += 1) {
					promises.push(loadFileContentEntry(filesToLoad[j], app.vault));
				}

				const batchResults = await Promise.all(promises);

				if (canceled) break;

				for (const { path, entry } of batchResults) {
					applyLoadedFileContentEntry(fileContentIndex, path, entry);
				}

				if (canceled || end >= filesToLoad.length) {
					continue;
				}

				await yieldToMainThreadIdleAware({ maxDelayMs: 16 });

				if (canceled) break;
			}

			if (canceled) return;

			isLoading = false;
		})();

		return () => {
			canceled = true;
			isLoading = false;
		};
	});

	// 対象ファイルに関係する Vault 更新だけを購読し、インデックスをリフレッシュ
	$effect(() => {
		const shouldListen = isEnabled() && indexedContentActivePaths.size > 0;

		if (!shouldListen) {
			return;
		}

		const unsubscribe = getFileContentVaultEventHub(app).subscribe(
			(changedFile, oldPath) => {
				const activePaths = untrack(() => indexedContentActivePaths);

				if (activePaths.has(changedFile.path)) {
					contentIndexRefreshNonce += 1;
					return;
				}

				if (oldPath && activePaths.has(oldPath)) {
					contentIndexRefreshNonce += 1;
				}
			},
		);

		return () => {
			unsubscribe();
		};
	});

	return {
		isLoading(): boolean {
			return isLoading;
		},
		getFirstMatchPosition(
			query: string,
			targetFile: TFile | null | undefined,
		): Pos | undefined {
			if (!targetFile) {
				return undefined;
			}

			const queryTerms = getSearchQueryTerms(query);
			if (queryTerms.length === 0) {
				return undefined;
			}

			const entry = fileContentIndex.get(targetFile.path);
			if (!entry?.content) {
				return undefined;
			}

			const cacheKey = queryTerms.join("\u0000");
			const cachedPosition = firstMatchPositionCacheByEntry.get(entry);
			if (cachedPosition && cachedPosition.queryKey === cacheKey) {
				return cachedPosition.position;
			}

			const normalizedContent = entry.content;
			let matchStart = -1;
			let matchTerm = "";
			for (const term of queryTerms) {
				const termMatchStart = normalizedContent.indexOf(term);
				if (
					termMatchStart !== -1 &&
					(matchStart === -1 || termMatchStart < matchStart)
				) {
					matchStart = termMatchStart;
					matchTerm = term;
				}
			}

			if (matchStart === -1) {
				firstMatchPositionCacheByEntry.set(entry, {
					queryKey: cacheKey,
					position: undefined,
				});
				return undefined;
			}

			const position = buildPosFromOffset(
				normalizedContent,
				matchStart,
				matchTerm.length,
			);
			firstMatchPositionCacheByEntry.set(entry, {
				queryKey: cacheKey,
				position,
			});
			return position;
		},
		forEachEntry(
			visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
		): void {
			for (const [path, entry] of fileContentIndex) {
				visitor(path, entry);
			}
		},
	};
}

function replaceActivePaths(target: SvelteSet<string>, next: Set<string>): void {
	target.clear();
	for (const path of next) {
		target.add(path);
	}
}

function countNewlinesUntil(content: string, endOffset: number): number {
	let lines = 0;
	for (let i = 0; i < endOffset; i += 1) {
		if (content.charCodeAt(i) === 10) {
			lines += 1;
		}
	}
	return lines;
}

function getLineStartOffset(content: string, offset: number): number {
	const newlineIndex = content.lastIndexOf("\n", Math.max(0, offset - 1));
	return newlineIndex === -1 ? 0 : newlineIndex + 1;
}

function buildPosFromOffset(
	content: string,
	startOffset: number,
	matchLength: number,
): Pos {
	const endOffset = startOffset + Math.max(1, matchLength);
	const startLine = countNewlinesUntil(content, startOffset);
	const endLine = countNewlinesUntil(content, endOffset);
	const startCol = startOffset - getLineStartOffset(content, startOffset);
	const endCol = endOffset - getLineStartOffset(content, endOffset);

	return {
		start: {
			line: startLine,
			col: startCol,
			offset: startOffset,
		},
		end: {
			line: endLine,
			col: endCol,
			offset: endOffset,
		},
	};
}
