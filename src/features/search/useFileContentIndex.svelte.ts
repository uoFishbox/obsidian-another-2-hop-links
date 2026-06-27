/**
 * ファイル内容検索インデックスを管理するカスタムフック
 *
 * 非同期でファイルをバッチ読み込みし、Vault の変更イベントを監視します。
 * インデックスの追跡・更新と、ファイル変更の自動リフレッシュを処理します。
 *
 * 使用例:
 * ```svelte
 * const contentIndex = useFileContentIndex(app, () => {
 *   return sortedItems.map(item => getTargetFile(item)).filter(Boolean);
 * });
 *
 * const hasMatch = (query: string, file: TFile) =>
 *   contentIndex.hasMatch(query, file);
 * ```
 */

import { TFile, type App, type Pos, type Vault } from "obsidian";
import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { getFileContent } from "features/preview/utils/previewUtils";
import {
	applyLoadedFileContentEntry,
	reconcileFileContentIndex,
	type SearchContentIndexEntry,
} from "features/search/fileContentSearchIndex";
import type { SearchWorkerFileContentSnapshot } from "./searchWorkerTypes";
import { getFileContentVaultEventHub } from "./fileContentVaultEventHub";
import { getSearchQueryTerms } from "./searchQueryTerms";

export interface FileContentIndexResult {
	hasMatch(query: string, targetFile: TFile | null | undefined): boolean;
	isLoading(): boolean;
	getFirstMatchPosition(
		query: string,
		targetFile: TFile | null | undefined,
	): Pos | undefined;
	forEachEntry(
		visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
	): void;
	getSerializableEntries(): SearchWorkerFileContentSnapshot[];
}

export interface UseFileContentIndexOptions {
	enabled?: boolean | (() => boolean);
}

const FIRST_MATCH_POSITION_CACHE_LIMIT = 8;

export class BoundedQueryCache<T> {
	private readonly entries = new Map<string, T>();

	constructor(private readonly limit: number) {
		if (!Number.isFinite(limit) || limit < 1) {
			throw new Error("limit must be a positive finite number");
		}
	}

	get(key: string): T | undefined {
		if (!this.entries.has(key)) {
			return undefined;
		}

		const value = this.entries.get(key);
		this.entries.delete(key);
		this.entries.set(key, value as T);
		return value;
	}

	has(key: string): boolean {
		return this.entries.has(key);
	}

	set(key: string, value: T): void {
		if (this.entries.has(key)) {
			this.entries.delete(key);
		}

		this.entries.set(key, value);
		this.evictIfNeeded();
	}

	size(): number {
		return this.entries.size;
	}

	keys(): string[] {
		return Array.from(this.entries.keys());
	}

	private evictIfNeeded(): void {
		while (this.entries.size > this.limit) {
			const oldestKey = this.entries.keys().next().value as string | undefined;
			if (oldestKey === undefined) {
				break;
			}
			this.entries.delete(oldestKey);
		}
	}
}

async function loadFileContentEntry(
	targetFile: TFile,
	vault: Vault,
): Promise<{ path: string; entry: SearchContentIndexEntry }> {
	const mtime = targetFile.stat.mtime;
	try {
		const content = await getFileContent(targetFile, vault);
		return { path: targetFile.path, entry: { content, mtime } };
	} catch {
		return { path: targetFile.path, entry: { content: "", mtime } };
	}
}

export function useFileContentIndex(
	app: App,
	getSearchableFiles: () => TFile[],
	options: UseFileContentIndexOptions = {},
): FileContentIndexResult {
	const { enabled = true } = options;
	const isEnabled = (): boolean =>
		typeof enabled === "function" ? enabled() : enabled;
	const fileContentIndex = new SvelteMap<string, SearchContentIndexEntry>();
	const indexedContentActivePaths = new SvelteSet<string>();
	const firstMatchPositionCacheByEntry = new WeakMap<
		SearchContentIndexEntry,
		BoundedQueryCache<Pos | undefined>
	>();
	const normalizedContentByEntry = new WeakMap<SearchContentIndexEntry, string>();
	const getNormalizedContent = (entry: SearchContentIndexEntry): string => {
		const cachedContent = normalizedContentByEntry.get(entry);
		if (cachedContent !== undefined) {
			return cachedContent;
		}

		const normalizedContent = entry.content.toLowerCase();
		normalizedContentByEntry.set(entry, normalizedContent);
		return normalizedContent;
	};
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
		const { nextIndex, filesToLoad, activePaths } = untrack(() =>
			reconcileFileContentIndex(searchableFiles, fileContentIndex),
		);

		replaceFileContentIndex(fileContentIndex, nextIndex);
		replaceActivePaths(indexedContentActivePaths, activePaths);

		isLoading = filesToLoad.length > 0;

		if (filesToLoad.length === 0) {
			return;
		}

		// staging に積みつつ、各バッチ完了ごとに reactive なインデックスへ反映する
		const stagedIndex = new Map(nextIndex);

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
					applyLoadedFileContentEntry(stagedIndex, path, entry);
					fileContentIndex.set(path, entry);
				}
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
		hasMatch(query: string, targetFile: TFile | null | undefined): boolean {
			if (!query || !targetFile) return false;
			const queryTerms = getSearchQueryTerms(query);
			if (queryTerms.length === 0) return false;
			const entry = fileContentIndex.get(targetFile.path);
			if (!entry?.content) return false;

			const normalizedContent = getNormalizedContent(entry);
			for (const term of queryTerms) {
				if (!normalizedContent.includes(term)) {
					return false;
				}
			}
			return true;
		},
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
			let cachedPositions = firstMatchPositionCacheByEntry.get(entry);
			if (cachedPositions?.has(cacheKey)) {
				return cachedPositions.get(cacheKey);
			}
			cachedPositions ??= new BoundedQueryCache<Pos | undefined>(
				FIRST_MATCH_POSITION_CACHE_LIMIT,
			);
			firstMatchPositionCacheByEntry.set(entry, cachedPositions);

			const normalizedContent = getNormalizedContent(entry);
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
				cachedPositions.set(cacheKey, undefined);
				return undefined;
			}

			const position = buildPosFromOffset(
				normalizedContent,
				matchStart,
				matchTerm.length,
			);
			cachedPositions.set(cacheKey, position);
			return position;
		},
		forEachEntry(
			visitor: (path: string, entry: Readonly<SearchContentIndexEntry>) => void,
		): void {
			for (const [path, entry] of fileContentIndex) {
				visitor(path, entry);
			}
		},
		getSerializableEntries(): SearchWorkerFileContentSnapshot[] {
			return Array.from(fileContentIndex, ([path, entry]) => ({
				path,
				content: entry.content,
				mtime: entry.mtime,
			}));
		},
	};
}

function replaceFileContentIndex(
	target: SvelteMap<string, SearchContentIndexEntry>,
	next: Map<string, SearchContentIndexEntry>,
): void {
	target.clear();
	for (const [path, entry] of next) {
		target.set(path, entry);
	}
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
