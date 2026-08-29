import { toCaseInsensitiveLookupKey } from "indexing/link-resolution/linkResolution";
import { hasDirectResolvedLookupKey } from "indexing/backlink-builder/lookupGraphQueries";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type {
	BacklinkBucket,
	BacklinkSourceMap,
	IndexedLinkQueryResult,
	IndexedLink,
} from "indexing/model";
import {
	compactStringSetFirst,
	compactStringSetSize,
	compactStringSetValues,
} from "shared/collections/compactStringSet";
import type { IVault } from "obsidian-integration/hostContracts";
import type { ReadonlyIndexState } from "../indexState";

interface LookupSourceView {
	sourceMap: BacklinkSourceMap;
	lookupKey?: string;
}

export class IndexQueryEngine {
	private readonly cachedIndexedLinks = new Map<string, IndexedLinkQueryResult>();
	private readonly cachedUniqueIndexedLinks = new Map<
		string,
		Map<string, IndexedLinkQueryResult>
	>();
	private readonly unresolvedMergedCache = new Map<string, BacklinkSourceMap>();
	private lastSnapshotReference: ReadonlyIndexState | undefined;

	constructor(private readonly vault: IVault) {}

	public getBacklinksForLink(
		snapshot: ReadonlyIndexState,
		linkPath: string,
	): IndexedLinkQueryResult {
		this.ensureSnapshotCacheScope(snapshot);
		const cached = this.cachedIndexedLinks.get(linkPath);
		if (cached) {
			return cached;
		}

		const lookupView = this.getSourceMapForLookup(snapshot, linkPath);
		if (!lookupView || lookupView.sourceMap.size === 0) {
			const links = this.freezeIndexedLinks([]);
			this.cachedIndexedLinks.set(linkPath, links);
			return links;
		}

		const links = this.freezeIndexedLinks(
			this.collectIncomingIndexedLinks(snapshot, lookupView, linkPath),
		);
		this.cachedIndexedLinks.set(linkPath, links);
		return links;
	}

	public getUniqueBacklinkSourcesForLink(
		snapshot: ReadonlyIndexState,
		linkPath: string,
		excludePath?: string,
		limit?: number,
	): IndexedLinkQueryResult {
		this.ensureSnapshotCacheScope(snapshot);
		const excludeKey = excludePath ?? "";
		const limitKey = typeof limit === "number" && limit > 0 ? String(limit) : "all";
		const cacheKey = `${excludeKey}\u0000${limitKey}`;
		let cacheByExclude = this.cachedUniqueIndexedLinks.get(linkPath);
		if (!cacheByExclude) {
			cacheByExclude = new Map<string, IndexedLinkQueryResult>();
			this.cachedUniqueIndexedLinks.set(linkPath, cacheByExclude);
		}

		const cached = cacheByExclude.get(cacheKey);
		if (cached) {
			return cached;
		}

		const lookupView = this.getSourceMapForLookup(snapshot, linkPath);
		if (!lookupView || lookupView.sourceMap.size === 0) {
			const links = this.freezeIndexedLinks([]);
			cacheByExclude.set(cacheKey, links);
			return links;
		}

		const links = this.freezeIndexedLinks(
			this.collectIncomingIndexedLinks(snapshot, lookupView, linkPath, {
				excludePath,
				limit,
			}),
		);
		cacheByExclude.set(cacheKey, links);
		return links;
	}

	private freezeIndexedLinks(links: IndexedLink[]): IndexedLinkQueryResult {
		for (const link of links) {
			Object.freeze(link);
		}
		return Object.freeze(links);
	}

	public getBacklinkCountForLink(
		snapshot: ReadonlyIndexState,
		linkPath: string,
	): number {
		this.ensureSnapshotCacheScope(snapshot);
		const directSourceMap = snapshot.backlinksMap.get(linkPath);
		if (directSourceMap && this.hasDirectResolvedEntries(snapshot, linkPath)) {
			return directSourceMap.size;
		}

		const unresolvedSourceMap = this.getOrBuildUnresolvedMergedSourceMap(
			snapshot,
			toCaseInsensitiveLookupKey(linkPath),
		);
		return unresolvedSourceMap?.size ?? directSourceMap?.size ?? 0;
	}

	public hasAtLeastUniqueBacklinkSources(
		snapshot: ReadonlyIndexState,
		linkPath: string,
		minCount: number,
		options?: {
			excludePath?: string;
			requireExistingSourceFile?: boolean;
		},
	): boolean {
		this.ensureSnapshotCacheScope(snapshot);
		if (minCount <= 0) {
			return true;
		}

		const directSourceMap = snapshot.backlinksMap.get(linkPath);

		// Prefer direct resolved entries when available — no Set allocation needed.
		if (directSourceMap && this.hasDirectResolvedEntries(snapshot, linkPath)) {
			return this.hasAtLeastFromSourcePaths(
				directSourceMap.keys(),
				minCount,
				options,
			);
		}

		const lookupKey = toCaseInsensitiveLookupKey(linkPath);
		const unresolvedSourceMap = this.getOrBuildUnresolvedMergedSourceMap(
			snapshot,
			lookupKey,
		);
		if (unresolvedSourceMap && unresolvedSourceMap.size > 0) {
			return this.hasAtLeastFromSourcePaths(
				unresolvedSourceMap.keys(),
				minCount,
				options,
			);
		}

		if (!directSourceMap || directSourceMap.size === 0) {
			return false;
		}

		return this.hasAtLeastFromSourcePaths(
			directSourceMap.keys(),
			minCount,
			options,
		);
	}

	public isUnresolvedWithSingleBacklink(
		snapshot: ReadonlyIndexState,
		lookupPath: string,
	): boolean {
		this.ensureSnapshotCacheScope(snapshot);
		const key = toCaseInsensitiveLookupKey(lookupPath);
		return this.getOrBuildUnresolvedMergedSourceMap(snapshot, key)?.size === 1;
	}

	public isUnresolvedWithSingleBacklinkBatch(
		snapshot: ReadonlyIndexState,
		lookupPaths: string[],
	): Map<string, boolean> {
		this.ensureSnapshotCacheScope(snapshot);
		const results = new Map<string, boolean>();
		let resolvedCount = 0;
		for (const path of lookupPaths) {
			const has = this.isUnresolvedWithSingleBacklink(snapshot, path);
			results.set(path, has);
			if (has) {
				resolvedCount++;
			}
		}

		return results;
	}

	public invalidate(paths?: Iterable<string>): void {
		if (!paths) {
			this.cachedIndexedLinks.clear();
			this.cachedUniqueIndexedLinks.clear();
			this.unresolvedMergedCache.clear();
			return;
		}

		for (const path of paths) {
			this.deleteQueryCacheEntriesForPath(path);
		}
	}

	private deleteQueryCacheEntriesForPath(path: string): void {
		const lookupKey = toCaseInsensitiveLookupKey(path);
		this.deleteCaseInsensitiveKey(this.cachedIndexedLinks, path, lookupKey);
		this.deleteCaseInsensitiveKey(this.cachedUniqueIndexedLinks, path, lookupKey);
		this.unresolvedMergedCache.delete(lookupKey);
	}

	private deleteCaseInsensitiveKey<T>(
		cache: Map<string, T>,
		path: string,
		lookupKey: string,
	): void {
		cache.delete(path);
		cache.delete(lookupKey);

		for (const key of cache.keys()) {
			if (toCaseInsensitiveLookupKey(key) === lookupKey) {
				cache.delete(key);
			}
		}
	}

	private hasAtLeastFromSourcePaths(
		sourcePaths: Iterable<string>,
		minCount: number,
		options?: {
			excludePath?: string;
			requireExistingSourceFile?: boolean;
		},
	): boolean {
		let count = 0;

		for (const sourcePath of sourcePaths) {
			if (options?.excludePath && sourcePath === options.excludePath) {
				continue;
			}

			if (options?.requireExistingSourceFile) {
				const sourceFile = resolveFileByPath(this.vault, sourcePath);
				if (!sourceFile) {
					continue;
				}
			}

			count++;
			if (count >= minCount) {
				return true;
			}
		}

		return false;
	}

	private collectIncomingIndexedLinks(
		snapshot: ReadonlyIndexState,
		lookupView: LookupSourceView,
		targetPath: string,
		options?: {
			excludePath?: string;
			limit?: number;
		},
	): IndexedLink[] {
		const links: IndexedLink[] = [];
		const hasLimit = typeof options?.limit === "number" && options.limit > 0;

		for (const [sourcePath, bucket] of lookupView.sourceMap.entries()) {
			if (options?.excludePath && sourcePath === options.excludePath) {
				continue;
			}

			const link = lookupView.lookupKey
				? this.buildBacklinkFromSourceSummaryByLookupKey(
						snapshot,
						sourcePath,
						lookupView.lookupKey,
						targetPath,
						bucket,
					)
				: this.buildBacklinkFromSourceSummary(
						snapshot,
						sourcePath,
						targetPath,
						bucket,
					);
			if (!link) {
				continue;
			}

			links.push(link);
			if (hasLimit && links.length >= (options?.limit ?? 0)) {
				break;
			}
		}

		return links;
	}

	private buildBacklinkFromSourceSummary(
		snapshot: ReadonlyIndexState,
		sourcePath: string,
		targetPath: string,
		bucket: BacklinkBucket,
	): IndexedLink | undefined {
		const sourceFile = resolveFileByPath(this.vault, sourcePath);
		if (!sourceFile) {
			return undefined;
		}

		const summary = snapshot.sourceSummaries.get(sourcePath);
		if (!summary) {
			return undefined;
		}

		const destination = summary.destinations.get(targetPath);
		if (!destination) {
			return undefined;
		}

		const ref = summary.orderedReferences[destination.firstRefIndex];
		if (!ref) {
			return undefined;
		}

		return {
			rawText: ref.rawText,
			path: targetPath,
			lookupPath: targetPath,
			isUnresolved: ref.isUnresolved,
			sourceFile,
			position: undefined,
			backlinkCount: bucket.count,
		};
	}

	private buildBacklinkFromSourceSummaryByLookupKey(
		snapshot: ReadonlyIndexState,
		sourcePath: string,
		lookupKey: string,
		displayPath: string,
		bucket: BacklinkBucket,
	): IndexedLink | undefined {
		const sourceFile = resolveFileByPath(this.vault, sourcePath);
		if (!sourceFile) {
			return undefined;
		}

		const summary = snapshot.sourceSummaries.get(sourcePath);
		if (!summary) {
			return undefined;
		}

		const lookupEntry = summary.lookupEntries.get(lookupKey);
		if (!lookupEntry) {
			return undefined;
		}

		const ref = summary.orderedReferences[lookupEntry.firstRefIndex];
		if (!ref) {
			return undefined;
		}

		return {
			rawText: ref.rawText,
			path: displayPath,
			lookupPath: displayPath,
			isUnresolved: ref.isUnresolved,
			sourceFile,
			position: undefined,
			backlinkCount: bucket.count,
		};
	}

	private getSourceMapForLookup(
		snapshot: ReadonlyIndexState,
		linkPath: string,
	): LookupSourceView | undefined {
		const directSourceMap = snapshot.backlinksMap.get(linkPath);
		if (directSourceMap && this.hasDirectResolvedEntries(snapshot, linkPath)) {
			return {
				sourceMap: directSourceMap,
			};
		}

		const unresolvedKey = toCaseInsensitiveLookupKey(linkPath);
		const unresolvedMergedMap = this.getOrBuildUnresolvedMergedSourceMap(
			snapshot,
			unresolvedKey,
		);
		if (!unresolvedMergedMap || unresolvedMergedMap.size === 0) {
			return directSourceMap
				? {
						sourceMap: directSourceMap,
					}
				: undefined;
		}
		return {
			sourceMap: unresolvedMergedMap,
			lookupKey: unresolvedKey,
		};
	}

	private hasDirectResolvedEntries(
		snapshot: ReadonlyIndexState,
		lookupPath: string,
	): boolean {
		return (snapshot.lookupPathResolvedSourceCount.get(lookupPath) ?? 0) > 0;
	}

	private getOrBuildUnresolvedMergedSourceMap(
		snapshot: ReadonlyIndexState,
		lookupKey: string,
	): BacklinkSourceMap | undefined {
		const cached = this.unresolvedMergedCache.get(lookupKey);
		if (cached) {
			return cached;
		}

		if (hasDirectResolvedLookupKey(snapshot, lookupKey)) {
			return undefined;
		}

		const lookupPaths = snapshot.lookupKeyToLookupPaths.get(lookupKey);
		if (!lookupPaths) {
			return undefined;
		}
		// Single lookup path: no merge needed — share the existing sourceMap
		// directly. Callers only read buckets (count, hasResolved) and never
		// mutate them, so sharing the snapshot reference is safe.
		if (compactStringSetSize(lookupPaths) === 1) {
			const lookupPath = compactStringSetFirst(lookupPaths)!;
			const sourceMap = snapshot.backlinksMap.get(lookupPath);
			if (!sourceMap || sourceMap.size === 0) {
				return undefined;
			}
			this.unresolvedMergedCache.set(lookupKey, sourceMap);
			return sourceMap;
		}

		const mergedSourceMap: BacklinkSourceMap = new Map();
		const sharedKeys = new Set<string>();
		for (const lookupPath of compactStringSetValues(lookupPaths)) {
			const sourceMap = snapshot.backlinksMap.get(lookupPath);
			if (!sourceMap || sourceMap.size === 0) {
				continue;
			}
			this.mergeSourceMapEntries(mergedSourceMap, sourceMap, sharedKeys);
		}
		if (mergedSourceMap.size === 0) {
			return undefined;
		}

		this.unresolvedMergedCache.set(lookupKey, mergedSourceMap);
		return mergedSourceMap;
	}

	/**
	 * Merge entries from `source` into `target`.
	 *
	 * Bucket references that have not yet collided are shared directly from
	 * the source map to avoid unnecessary clones.  When a sourcePath collides
	 * with an entry that is still a shared reference (tracked via
	 * `sharedKeys`), a new owned bucket is created so the original snapshot
	 * bucket is never mutated.
	 */
	private mergeSourceMapEntries(
		target: BacklinkSourceMap,
		source: BacklinkSourceMap,
		sharedKeys: Set<string>,
	): void {
		for (const [sourcePath, infoCollection] of source) {
			const existing = target.get(sourcePath);
			if (existing) {
				if (sharedKeys.has(sourcePath)) {
					// existing is a shared reference to a snapshot bucket —
					// create a new owned bucket to avoid mutating the snapshot.
					const count = existing.count + infoCollection.count;
					target.set(sourcePath, {
						count,
						hasResolved: existing.hasResolved || infoCollection.hasResolved,
					});
					sharedKeys.delete(sourcePath);
				} else {
					// existing is already an owned bucket — safe to mutate
					existing.count += infoCollection.count;
					existing.hasResolved ||= infoCollection.hasResolved;
				}
			} else {
				// First encounter — share reference (no clone needed)
				target.set(sourcePath, infoCollection);
				sharedKeys.add(sourcePath);
			}
		}
	}

	private ensureSnapshotCacheScope(snapshot: ReadonlyIndexState): void {
		if (this.lastSnapshotReference === snapshot) {
			return;
		}

		this.cachedIndexedLinks.clear();
		this.cachedUniqueIndexedLinks.clear();
		this.unresolvedMergedCache.clear();
		this.lastSnapshotReference = snapshot;
	}
}
