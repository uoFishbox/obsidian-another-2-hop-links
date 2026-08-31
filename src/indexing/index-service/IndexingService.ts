import { TFile } from "obsidian";
import {
	getNotesWithCommonTagsFromTagRefs,
	getNotesWithTag,
} from "indexing/tag-index/tagIndexer";
import { extractTags } from "indexing/metadata/metadataExtractor";
import { buildIndexesAsync } from "indexing/index-service/indexSnapshotBuilder";
import { IncrementalIndexUpdater } from "indexing/index-service/IncrementalIndexUpdater";
import { collectSourcePathsForLookupKeys } from "indexing/backlink-builder/lookupGraphQueries";
import { IndexQueryEngine } from "indexing/index-service/IndexQueryEngine";
import { TagIndexStore } from "indexing/tag-index/TagIndexStore";
import type { IndexedLinkQueryResult, TaggedNote, TagReference } from "indexing/model";
import type { IVault, IMetadataCache } from "obsidian-integration/hostContracts";
import { INDEXING_YIELD_INTERVAL_MS } from "indexing/config";
import {
	createEmptyMutableIndexState,
	type IncrementalFileChange,
	type MutableIndexState,
	type RebuildOptions,
	type TimeSlicingOptions,
} from "../indexState";
import { createEmptyTagIndex } from "../tag-index/tagIndexMutations";
import type { DataUpdateContext, DataUpdateListener } from "./IndexEvents";
import { IndexWriteCoordinator, type RebuildReason } from "./IndexWriteCoordinator";
import { defaultYieldToMainThread } from "../timeSlicing";

export type {
	IncrementalFileChange,
	IncrementalFileChangeType,
	RebuildOptions,
	TagIndex,
} from "../indexState";
export type { DataUpdateContext, DataUpdateListener } from "./IndexEvents";

export interface IIndexingService {
	invalidateAll(): void;
	getSourcePathsForLookupKeys(lookupKeys: Iterable<string>): Set<string>;
	getBacklinksForLink(linkPath: string): IndexedLinkQueryResult;
	getUniqueBacklinkSourcesForLink(
		linkPath: string,
		excludePath?: string,
		limit?: number,
	): IndexedLinkQueryResult;
	getBacklinkCountForLink(linkPath: string): number;
	hasAtLeastUniqueBacklinkSources(
		linkPath: string,
		minCount: number,
		options?: {
			excludePath?: string;
			requireExistingSourceFile?: boolean;
		},
	): boolean;
	isReady(): boolean;
	getIndexVersion(): number;
	peekNotesWithCommonTags(file: TFile): TaggedNote[];
	getNotesWithTag(tag: string, sourcePath?: string): Promise<TaggedNote[]>;
	peekNotesWithTag(tag: string, sourcePath?: string): TaggedNote[];
	awaitIdle(): Promise<void>;
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;
	isUnresolvedWithSingleBacklinkBatch(lookupPaths: string[]): Map<string, boolean>;
	onDataUpdate(listener: (context: DataUpdateContext) => void): () => void;
}

/** Controls one staged full rebuild whose state remains private until commit. */
export interface StagedIndexRebuild {
	/** Atomically replaces the live indexes and publishes one full update. */
	commit(): void;

	/** Drops the staged indexes without changing or notifying live readers. */
	discard(): void;
}

interface StagedIndexRebuildState {
	generation: number;
	snapshot: MutableIndexState;
	tagIndexStore: TagIndexStore;
}

export class IndexingService implements IIndexingService {
	private snapshot: MutableIndexState = createEmptyMutableIndexState();
	private readonly incrementalUpdater: IncrementalIndexUpdater;
	private readonly queryEngine: IndexQueryEngine;
	private readonly tagIndexStore: TagIndexStore;
	private readonly writeCoordinator: IndexWriteCoordinator;
	private readonly externalIdleWaiters = new Set<() => Promise<void>>();
	private readonly dataUpdateListeners = new Set<DataUpdateListener>();
	private stagedRebuild: StagedIndexRebuildState | undefined;
	private stagedRebuildGeneration = 0;
	private indexVersion = 0;
	private ready = false;
	private commonTagsCache:
		| {
				path: string;
				indexVersion: number;
				targetTagsKey: string;
				result: TaggedNote[];
		  }
		| undefined;

	constructor(
		private readonly vault: IVault,
		private readonly metadataCache: IMetadataCache,
		private readonly isTagFeatureEnabled: () => boolean = () => true,
	) {
		this.incrementalUpdater = new IncrementalIndexUpdater(metadataCache);
		this.queryEngine = new IndexQueryEngine(vault, metadataCache);
		this.tagIndexStore = new TagIndexStore(
			vault,
			metadataCache,
			isTagFeatureEnabled,
		);
		this.writeCoordinator = new IndexWriteCoordinator({
			applyIncremental: (changes, options) =>
				this.executeFileChangesTimeSliced(changes, options),
			rebuild: (context) =>
				this.executeRebuildTimeSliced(context.options, context.isCurrent),
		});
	}

	public onDataUpdate(listener: DataUpdateListener): () => void {
		this.dataUpdateListeners.add(listener);
		return () => {
			this.dataUpdateListeners.delete(listener);
		};
	}

	public getIndexVersion(): number {
		return this.indexVersion;
	}

	public isReady(): boolean {
		return this.ready;
	}

	public async awaitIdle(): Promise<void> {
		for (;;) {
			const activityGeneration = this.writeCoordinator.getActivityGeneration();
			if (!this.writeCoordinator.isIdleAtActivityGeneration(activityGeneration)) {
				await this.writeCoordinator.awaitIdle();
			}

			const externalWaits = Array.from(this.externalIdleWaiters, (waiter) =>
				waiter(),
			);
			if (externalWaits.length > 0) {
				await Promise.all(externalWaits);
			}

			if (this.writeCoordinator.isIdleAtActivityGeneration(activityGeneration)) {
				return;
			}
		}
	}

	public registerIdleWaiter(waiter: () => Promise<void>): () => void {
		this.externalIdleWaiters.add(waiter);
		return () => {
			this.externalIdleWaiters.delete(waiter);
		};
	}

	public getSourcePathsForLookupKeys(lookupKeys: Iterable<string>): Set<string> {
		return collectSourcePathsForLookupKeys(this.snapshot, lookupKeys);
	}

	public getBacklinksForLink(linkPath: string) {
		return this.queryEngine.getBacklinksForLink(this.snapshot, linkPath);
	}

	public getUniqueBacklinkSourcesForLink(
		linkPath: string,
		excludePath?: string,
		limit?: number,
	) {
		return this.queryEngine.getUniqueBacklinkSourcesForLink(
			this.snapshot,
			linkPath,
			excludePath,
			limit,
		);
	}

	public getBacklinkCountForLink(linkPath: string): number {
		return this.queryEngine.getBacklinkCountForLink(this.snapshot, linkPath);
	}

	public hasAtLeastUniqueBacklinkSources(
		linkPath: string,
		minCount: number,
		options?: {
			excludePath?: string;
			requireExistingSourceFile?: boolean;
		},
	): boolean {
		return this.queryEngine.hasAtLeastUniqueBacklinkSources(
			this.snapshot,
			linkPath,
			minCount,
			options,
		);
	}

	public isUnresolvedWithSingleBacklink(lookupPath: string): boolean {
		return this.queryEngine.isUnresolvedWithSingleBacklink(
			this.snapshot,
			lookupPath,
		);
	}

	public isUnresolvedWithSingleBacklinkBatch(
		lookupPaths: string[],
	): Map<string, boolean> {
		return this.queryEngine.isUnresolvedWithSingleBacklinkBatch(
			this.snapshot,
			lookupPaths,
		);
	}

	public peekNotesWithCommonTags(file: TFile): TaggedNote[] {
		if (!this.isTagFeatureEnabled()) {
			return [];
		}

		const tagIndex = this.tagIndexStore.getSnapshot();
		const tagRefs: readonly TagReference[] =
			tagIndex.fileEntries.get(file.path) ??
			extractTags(this.metadataCache.getFileCache(file));

		const targetTagsKey = createTagRefsCacheKey(tagRefs);
		const indexVersion = this.getIndexVersion();
		const cached = this.commonTagsCache;

		if (
			cached &&
			cached.path === file.path &&
			cached.indexVersion === indexVersion &&
			cached.targetTagsKey === targetTagsKey
		) {
			return cached.result;
		}

		const result = getNotesWithCommonTagsFromTagRefs(
			this.vault,
			tagIndex,
			file,
			tagRefs,
		);
		this.commonTagsCache = {
			path: file.path,
			indexVersion,
			targetTagsKey,
			result,
		};
		return result;
	}

	public peekNotesWithTag(tag: string, _sourcePath?: string): TaggedNote[] {
		if (!this.isTagFeatureEnabled()) {
			return [];
		}

		return getNotesWithTag(this.vault, this.tagIndexStore.getSnapshot(), tag);
	}

	public async getNotesWithTag(
		tag: string,
		_sourcePath?: string,
	): Promise<TaggedNote[]> {
		if (!this.isTagFeatureEnabled()) {
			return [];
		}

		await this.awaitIdle();
		return this.peekNotesWithTag(tag, _sourcePath);
	}

	public invalidateAll(): void {
		this.queryEngine.invalidate();
		this.commonTagsCache = undefined;
	}

	/**
	 * Starts a full rebuild transaction for startup indexing.
	 * Rebuild and incremental writes target private state until the returned
	 * transaction is committed.
	 */
	public beginStagedRebuild(): StagedIndexRebuild {
		const generation = ++this.stagedRebuildGeneration;
		this.stagedRebuild = {
			generation,
			snapshot: createEmptyMutableIndexState(),
			tagIndexStore: new TagIndexStore(
				this.vault,
				this.metadataCache,
				this.isTagFeatureEnabled,
			),
		};
		let settled = false;

		return {
			commit: () => {
				if (settled) return;
				settled = true;
				this.commitStagedRebuild(generation);
			},
			discard: () => {
				if (settled) return;
				settled = true;
				this.discardStagedRebuild(generation);
			},
		};
	}

	public async rebuildIndexesTimeSliced(options: RebuildOptions = {}): Promise<void> {
		await this.enqueueRebuild("requested", options);
	}

	public async enqueueRebuild(
		reason: RebuildReason,
		options: RebuildOptions = {},
	): Promise<void> {
		await this.writeCoordinator.enqueueRebuild(reason, options);
	}

	private async executeRebuildTimeSliced(
		options: RebuildOptions,
		isCurrent: () => boolean,
	): Promise<void> {
		if (!this.stagedRebuild) {
			this.queryEngine.invalidate();
			this.commonTagsCache = undefined;
		}
		const includeTagIndex = this.isTagFeatureEnabled();
		const result = await buildIndexesAsync(
			this.vault,
			this.metadataCache,
			options,
			includeTagIndex,
		);

		if (!isCurrent()) {
			return;
		}

		const stagedRebuild = this.stagedRebuild;
		if (stagedRebuild) {
			stagedRebuild.snapshot = result.snapshot;
			stagedRebuild.tagIndexStore.replace(
				includeTagIndex ? result.tagIndex : createEmptyTagIndex(),
			);
			await (options.yieldFn ?? defaultYieldToMainThread)();
			return;
		}

		this.snapshot = result.snapshot;
		this.tagIndexStore.replace(
			includeTagIndex ? result.tagIndex : createEmptyTagIndex(),
		);
		await this.finishFullRebuildTimeSliced(
			options.yieldFn ?? defaultYieldToMainThread,
		);
	}

	public async applyFileChangesTimeSliced(
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<void> {
		await this.writeCoordinator.enqueueIncremental(changes, options);
	}

	private async executeFileChangesTimeSliced(
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions,
	): Promise<void> {
		// esbuild replaces process.env.NODE_ENV at build time, so this branch is
		// dead-code eliminated in production builds.
		const shouldLog = process.env.NODE_ENV === "development";
		const startedAt = shouldLog ? performance.now() : 0;
		if (shouldLog) {
			console.info(
				"[IndexingService] Incremental index update start:",
				countChangesByType(changes),
			);
		}
		const stagedRebuild = this.stagedRebuild;
		const targetSnapshot = stagedRebuild?.snapshot ?? this.snapshot;
		const targetTagIndexStore = stagedRebuild?.tagIndexStore ?? this.tagIndexStore;
		const timeSlicingOptions = {
			yieldFn: options.yieldFn ?? defaultYieldToMainThread,
			yieldIntervalMs: options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
		};
		const result = await this.incrementalUpdater.applyAsync(
			targetSnapshot,
			changes,
			timeSlicingOptions,
		);
		if (stagedRebuild) {
			stagedRebuild.snapshot = result.snapshot;
		} else {
			this.snapshot = result.snapshot;
		}
		const tagResult = await targetTagIndexStore.applyFileChangesAsync(
			changes,
			timeSlicingOptions,
		);
		const changedFilePaths = result.changedFilePaths;
		const changedLookupKeys = result.changedLookupKeys;
		const affectedTags = tagResult.affectedTags;
		const changedLinkSourcePaths = result.changedLinkSourcePaths;
		const affectedTagSourcePaths = tagResult.affectedTagSourcePaths;
		const linkIndexChanged = result.linkIndexChanged;

		if (shouldLog) {
			console.info("[IndexingService] Incremental index update end (ms):", {
				durationMs: roundTimingMs(performance.now() - startedAt),
				changeCount: changes.length,
				changedFilePaths: changedFilePaths.size,
				changedLookupKeys: changedLookupKeys.size,
				changedLinkSourcePaths: changedLinkSourcePaths.size,
				affectedTags: affectedTags.size,
				linkIndexChanged,
			});
		}

		if (linkIndexChanged && !stagedRebuild) {
			this.queryEngine.invalidate(result.cacheInvalidationKeys);
		}
		if (stagedRebuild) {
			return;
		}

		this.bumpIndexVersion();
		this.notifyDataUpdate({
			affectedPaths: changedFilePaths,
			affectedLookupKeys: changedLookupKeys,
			affectedTags,
			affectedLinkSourcePaths: changedLinkSourcePaths,
			affectedTagSourcePaths,
		});
	}

	private async finishFullRebuildTimeSliced(
		yieldToMainThread: () => Promise<void>,
	): Promise<void> {
		await yieldToMainThread();
		this.ready = true;
		this.bumpIndexVersion();
		this.notifyDataUpdate({ affectsAll: true });
	}

	private bumpIndexVersion(): void {
		this.indexVersion++;
	}

	private commitStagedRebuild(generation: number): void {
		const stagedRebuild = this.stagedRebuild;
		if (!stagedRebuild || stagedRebuild.generation !== generation) {
			return;
		}

		this.stagedRebuild = undefined;
		this.snapshot = stagedRebuild.snapshot;
		this.tagIndexStore.replace(stagedRebuild.tagIndexStore.getSnapshot());
		this.queryEngine.invalidate();
		this.commonTagsCache = undefined;
		this.ready = true;
		this.bumpIndexVersion();
		this.notifyDataUpdate({ affectsAll: true });
	}

	private discardStagedRebuild(generation: number): void {
		if (this.stagedRebuild?.generation !== generation) {
			return;
		}
		this.stagedRebuild = undefined;
	}

	private notifyDataUpdate(
		context: {
			affectsAll?: boolean;
			affectedPaths?: Iterable<string>;
			affectedLookupKeys?: Iterable<string>;
			affectedTags?: Iterable<string>;
			affectedLinkSourcePaths?: Iterable<string>;
			affectedTagSourcePaths?: Iterable<string>;
		} = {},
	): void {
		if (this.dataUpdateListeners.size === 0) return;

		const payload: DataUpdateContext = {
			affectsAll: context.affectsAll,
			// DataUpdateContext is consumed by external view listeners. Keep its
			// array payload stable; internal consumers accept Set input as well.
			affectedPaths: context.affectedPaths
				? Array.from(context.affectedPaths)
				: undefined,
			affectedLookupKeys: context.affectedLookupKeys
				? Array.from(context.affectedLookupKeys)
				: undefined,
			affectedTags: context.affectedTags
				? Array.from(context.affectedTags)
				: undefined,
			affectedLinkSourcePaths: context.affectedLinkSourcePaths
				? Array.from(context.affectedLinkSourcePaths)
				: undefined,
			affectedTagSourcePaths: context.affectedTagSourcePaths
				? Array.from(context.affectedTagSourcePaths)
				: undefined,
		};

		for (const listener of this.dataUpdateListeners) {
			try {
				listener(payload);
			} catch (error) {
				console.error("Error in data update listener:", error);
			}
		}
	}
}

/**
 * Creates a cache key for a TagReference[] value.
 * Joins each ref.tag with a NUL character and returns an empty string when no tags exist.
 */
function createTagRefsCacheKey(tags: readonly TagReference[]): string {
	if (tags.length === 0) {
		return "";
	}

	let key = tags[0].tag;
	for (let i = 1; i < tags.length; i++) {
		key += "\u0000" + tags[i].tag;
	}

	return key;
}

function countChangesByType(
	changes: readonly IncrementalFileChange[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const change of changes) {
		counts[change.type] = (counts[change.type] ?? 0) + 1;
	}
	return counts;
}

function roundTimingMs(durationMs: number): number {
	return Math.round(durationMs * 10) / 10;
}
