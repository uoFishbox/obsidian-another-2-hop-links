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
import type {
	BacklinksMap,
	IndexedLinkQueryResult,
	TaggedNote,
	TagReference,
} from "indexing/model";
import type { IVault, IMetadataCache } from "obsidian-integration/hostContracts";
import {
	INDEXING_REBUILD_YIELD_INTERVAL_MS,
	INDEXING_YIELD_INTERVAL_MS,
} from "indexing/config";
import {
	createEmptyIndexSnapshot,
	type IncrementalFileChange,
	type IndexSnapshot,
	type RebuildOptions,
	type TimeSlicingOptions,
} from "../indexState";
import { createEmptyTagIndex } from "../tag-index/tagIndexMutations";
import type { DataUpdateContext, DataUpdateListener } from "./IndexEvents";
import { IndexWriteCoordinator, type RebuildReason } from "./IndexWriteCoordinator";
import { defaultYieldToMainThread } from "../timeSlicing";
import {
	createLinkResolutionAmbiguityDetector,
	type MutableLinkResolutionAmbiguityDetector,
} from "../link-resolution/linkResolution";

export type {
	IncrementalFileChange,
	IncrementalFileChangeType,
	RebuildOptions,
	TagIndex,
} from "../indexState";
export type { DataUpdateContext, DataUpdateListener } from "./IndexEvents";

export interface IIndexingService {
	getBacklinksMap(): BacklinksMap;
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
	getIndexVersion(): number;
	peekNotesWithCommonTags(file: TFile): TaggedNote[];
	getNotesWithTag(tag: string, sourcePath?: string): Promise<TaggedNote[]>;
	peekNotesWithTag(tag: string, sourcePath?: string): TaggedNote[];
	awaitIdle(): Promise<void>;
	isUnresolvedWithSingleBacklink(lookupPath: string): boolean;
	isUnresolvedWithSingleBacklinkBatch(lookupPaths: string[]): Map<string, boolean>;
	onDataUpdate(listener: (context: DataUpdateContext) => void): () => void;
}

export class IndexingService implements IIndexingService {
	private snapshot: IndexSnapshot = createEmptyIndexSnapshot();
	private readonly incrementalUpdater: IncrementalIndexUpdater;
	private readonly ambiguityDetector: MutableLinkResolutionAmbiguityDetector;
	private readonly queryEngine: IndexQueryEngine;
	private readonly tagIndexStore: TagIndexStore;
	private readonly writeCoordinator: IndexWriteCoordinator;
	private readonly externalIdleWaiters = new Set<() => Promise<void>>();
	private readonly dataUpdateListeners = new Set<DataUpdateListener>();
	private indexVersion = 0;
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
		this.ambiguityDetector = createLinkResolutionAmbiguityDetector(vault);
		this.incrementalUpdater = new IncrementalIndexUpdater(
			vault,
			metadataCache,
			this.ambiguityDetector,
		);
		this.queryEngine = new IndexQueryEngine(vault);
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

	public getBacklinksMap(): BacklinksMap {
		return this.snapshot.backlinksMap;
	}

	public getSourcePathsForLookupKeys(lookupKeys: Iterable<string>): Set<string> {
		return collectSourcePathsForLookupKeys(this.snapshot, lookupKeys);
	}

	public getTagIndexFileCount(): number {
		if (!this.isTagFeatureEnabled()) {
			return 0;
		}
		return this.tagIndexStore.getSnapshot().fileEntries.size;
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

	public async rebuildBacklinksMapChunked(
		yieldIntervalMs = INDEXING_REBUILD_YIELD_INTERVAL_MS,
	): Promise<void> {
		await this.rebuildIndexesTimeSliced({ yieldIntervalMs });
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
		this.queryEngine.invalidate();
		this.commonTagsCache = undefined;
		const includeTagIndex = this.isTagFeatureEnabled();
		const result = await buildIndexesAsync(
			this.vault,
			this.metadataCache,
			options,
			includeTagIndex,
			this.ambiguityDetector,
		);

		if (!isCurrent()) {
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
		const timeSlicingOptions = {
			yieldFn: options.yieldFn ?? defaultYieldToMainThread,
			yieldIntervalMs: options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
		};
		const result = await this.incrementalUpdater.applyAsync(
			this.snapshot,
			changes,
			timeSlicingOptions,
		);
		this.snapshot = result.snapshot;
		const tagResult = await this.tagIndexStore.applyFileChangesAsync(
			changes,
			timeSlicingOptions,
		);
		const affectedPaths = result.affectedPaths;
		const affectedLookupKeys = result.affectedLookupKeys;
		const affectedTags = tagResult.affectedTags;
		const affectedLinkSourcePaths = result.affectedLinkSourcePaths;
		const affectedTagSourcePaths = tagResult.affectedTagSourcePaths;
		const linkIndexChanged = result.linkIndexChanged;

		if (linkIndexChanged) {
			this.queryEngine.invalidate(result.cacheInvalidationPaths);
		}

		this.bumpIndexVersion();
		this.notifyDataUpdate({
			affectedPaths,
			affectedLookupKeys,
			affectedTags,
			affectedLinkSourcePaths,
			affectedTagSourcePaths,
		});
	}

	private async finishFullRebuildTimeSliced(
		yieldToMainThread: () => Promise<void>,
	): Promise<void> {
		await yieldToMainThread();
		this.bumpIndexVersion();
		this.notifyDataUpdate({ affectsAll: true });
	}

	private bumpIndexVersion(): void {
		this.indexVersion++;
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
 * TagReference[] のキャッシュキーを生成する。
 * 各 ref.tag を NUL 文字で結合し、空の場合は空文字列を返す。
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
