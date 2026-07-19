import { TFile } from "obsidian";
import {
	getNotesWithCommonTagsFromTagRefs,
	getNotesWithTag,
} from "core/indexing/tag-index/tagIndexer";
import { extractTags } from "core/indexing/metadata/metadataExtractor";
import { buildIndexesAsync } from "core/indexing/index-service/indexSnapshotBuilder";
import { IncrementalIndexUpdater } from "core/indexing/index-service/IncrementalIndexUpdater";
import { IndexQueryEngine } from "core/indexing/index-service/IndexQueryEngine";
import {
	EMPTY_TAG_MUTATION_RESULT,
	TagIndexStore,
} from "core/indexing/tag-index/TagIndexStore";
import type { TaggedNote, TagReference, BacklinksMap } from "types/domain";
import type { IVault, IMetadataCache } from "types/obsidian";
import type { IIndexingService } from "types/services";
import {
	INDEXING_REBUILD_YIELD_INTERVAL_MS,
	INDEXING_YIELD_INTERVAL_MS,
	PLUGIN_NAME,
} from "../../../appConstants";
import { enableLogging, logger } from "utils/logger";
import {
	createEmptyIndexSnapshot,
	type IncrementalFileChange,
	type IncrementalFileChangeType,
	type IndexSnapshot,
	type RebuildOptions,
	type TagIndex,
	type TagIndexEntry,
} from "../types/IndexTypes";
import { createEmptyTagIndex } from "../tag-index/tagIndexMutations";
import { type DataUpdateContext, type DataUpdateListener } from "./IndexEvents";
import { IndexingRunState } from "./IndexingRunState";
import { IndexUpdateEmitter } from "./IndexUpdateEmitter";
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
	TagIndexEntry,
} from "../types/IndexTypes";
export type { DataUpdateContext, DataUpdateListener } from "./IndexEvents";

export class IndexingService implements IIndexingService {
	private snapshot: IndexSnapshot = createEmptyIndexSnapshot();
	private readonly incrementalUpdater: IncrementalIndexUpdater;
	private readonly ambiguityDetector: MutableLinkResolutionAmbiguityDetector;
	private readonly queryEngine: IndexQueryEngine;
	private readonly tagIndexStore: TagIndexStore;
	private readonly runState = new IndexingRunState();
	private readonly updateEmitter = new IndexUpdateEmitter();
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
	}

	public onDataUpdate(listener: DataUpdateListener): () => void {
		return this.updateEmitter.onDataUpdate(listener);
	}

	public getIndexVersion(): number {
		return this.updateEmitter.getIndexVersion();
	}

	public async awaitIdle(): Promise<void> {
		await this.runState.awaitIdle();
	}

	public registerIdleWaiter(waiter: () => Promise<void>): () => void {
		return this.runState.registerIdleWaiter(waiter);
	}

	public getBacklinksMap(): BacklinksMap {
		return this.snapshot.backlinksMap;
	}

	public getSourcePathsForLookupKeys(lookupKeys: Iterable<string>): Set<string> {
		const result = new Set<string>();

		for (const lookupKey of lookupKeys) {
			const sources = this.snapshot.lookupKeyToSources.get(lookupKey);
			if (!sources) {
				continue;
			}

			for (const sourcePath of sources) {
				result.add(sourcePath);
			}
		}

		return result;
	}

	public getTagIndexFileCount(): number {
		if (!this.isTagFeatureEnabled()) {
			return 0;
		}
		return this.tagIndexStore.getSnapshot().fileEntries.size;
	}

	public exportPersistableState(): {
		snapshot: IndexSnapshot;
		tagIndex: TagIndex;
	} {
		return {
			snapshot: this.snapshot,
			tagIndex: this.isTagFeatureEnabled()
				? this.tagIndexStore.getSnapshot()
				: createEmptyTagIndex(),
		};
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
		const indexedEntry = tagIndex.fileEntries.get(file.path);
		const tagRefs: readonly TagReference[] =
			indexedEntry?.tags ?? extractTags(this.metadataCache.getFileCache(file));

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

	public async getNotesWithCommonTags(file: TFile): Promise<TaggedNote[]> {
		if (!this.isTagFeatureEnabled()) {
			return [];
		}

		await this.awaitIdle();
		return this.peekNotesWithCommonTags(file);
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
		this.tagIndexStore.clear();
	}

	public replaceSnapshot(snapshot: IndexSnapshot, tagIndex: TagIndex): void {
		this.snapshot = snapshot;
		this.tagIndexStore.replace(tagIndex);
		this.queryEngine.invalidate();
	}

	public async rebuildBacklinksMapChunked(
		yieldIntervalMs = INDEXING_REBUILD_YIELD_INTERVAL_MS,
	): Promise<void> {
		await this.rebuildIndexesTimeSliced({ yieldIntervalMs });
	}

	public async rebuildIndexesTimeSliced(options: RebuildOptions = {}): Promise<void> {
		if (enableLogging)
			logger(
				"[IndexingService.rebuildBacklinksMapChunked] Starting backlinks map rebuild",
			);
		this.beginIndexing();
		this.queryEngine.invalidate();
		this.commonTagsCache = undefined;
		const shouldLogRebuildTiming =
			process.env.NODE_ENV !== "production" || enableLogging;
		const startTime = shouldLogRebuildTiming ? performance.now() : undefined;

		try {
			const includeTagIndex = this.isTagFeatureEnabled();
			const result = await buildIndexesAsync(
				this.vault,
				this.metadataCache,
				options,
				includeTagIndex,
				this.ambiguityDetector,
			);
			this.snapshot = result.snapshot;
			this.tagIndexStore.replace(
				includeTagIndex ? result.tagIndex : createEmptyTagIndex(),
			);
			this.logRebuildComplete(
				"[IndexingService.rebuildBacklinksMapChunked] Rebuilt backlinks map with",
				startTime,
			);
			await this.finishFullRebuildTimeSliced(
				options.yieldFn ?? defaultYieldToMainThread,
			);
		} finally {
			this.endIndexing();
		}
	}

	public async applyFileChangesTimeSliced(
		changes: IncrementalFileChange[],
		options: {
			yieldFn?: () => Promise<void>;
			yieldIntervalMs?: number;
		} = {},
	): Promise<void> {
		if (changes.length === 0) {
			return;
		}

		if (enableLogging)
			logger(
				`[IndexingService.applyFileChangesTimeSliced] Applying ${changes.length} file changes`,
			);
		this.beginIndexing();

		const sourceContentChangedPaths = new Set<string>();

		try {
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
			const tagResult = this.isTagFeatureEnabled()
				? await this.tagIndexStore.applyFileChangesAsync(
						changes,
						timeSlicingOptions,
					)
				: EMPTY_TAG_MUTATION_RESULT;
			const affectedPaths = result.affectedPaths;
			const affectedLookupKeys = result.affectedLookupKeys;
			const affectedTags = tagResult.affectedTags;
			const affectedLinkSourcePaths = result.affectedLinkSourcePaths;
			const affectedTagSourcePaths = tagResult.affectedTagSourcePaths;

			for (const change of changes) {
				if (change.type === "rename") {
					sourceContentChangedPaths.add(change.oldPath);
					sourceContentChangedPaths.add(change.newPath);
				} else {
					sourceContentChangedPaths.add(change.path);
				}
			}

			const linkIndexChanged = result.linkIndexChanged;
			const tagIndexChanged = tagResult.tagIndexChanged;
			const sourceContentChanged = sourceContentChangedPaths.size > 0;

			const shouldInvalidateQueryCache = linkIndexChanged;

			const shouldNotifyDataUpdate =
				sourceContentChanged || linkIndexChanged || tagIndexChanged;

			if (shouldInvalidateQueryCache) {
				this.queryEngine.invalidate(result.cacheInvalidationPaths);
			}

			if (enableLogging)
				logger(
					"[IndexingService.applyFileChangesTimeSliced] Applied changes complete",
				);

			if (shouldNotifyDataUpdate) {
				this.bumpIndexVersion();
				this.notifyDataUpdate({
					affectedPaths,
					affectedLookupKeys,
					affectedTags,
					affectedLinkSourcePaths,
					affectedTagSourcePaths,
					affectedSourceContentPaths: sourceContentChangedPaths,
					linkIndexChanged,
					tagIndexChanged,
					sourceContentChanged,
				});
			}
		} finally {
			this.endIndexing();
		}
	}

	private async finishFullRebuildTimeSliced(
		yieldToMainThread: () => Promise<void>,
	): Promise<void> {
		await yieldToMainThread();
		this.bumpIndexVersion();
		this.notifyDataUpdate({ affectsAll: true });
	}

	private logRebuildComplete(message: string, startTime: number | undefined): void {
		if (startTime !== undefined) {
			const duration = performance.now() - startTime;
			console.log(
				`[${PLUGIN_NAME}] Backlinks map built: ${this.snapshot.backlinksMap.size} entries in ${duration.toFixed(2)}ms`,
			);
		}
		if (enableLogging)
			logger(`${message} ${this.snapshot.backlinksMap.size} entries`);
	}

	private bumpIndexVersion(): void {
		this.updateEmitter.bumpIndexVersion();
	}

	private notifyDataUpdate(
		context: {
			affectsAll?: boolean;
			affectedPaths?: Iterable<string>;
			affectedLookupKeys?: Iterable<string>;
			affectedTags?: Iterable<string>;
			affectedLinkSourcePaths?: Iterable<string>;
			affectedTagSourcePaths?: Iterable<string>;
			affectedSourceContentPaths?: Iterable<string>;
			linkIndexChanged?: boolean;
			tagIndexChanged?: boolean;
			sourceContentChanged?: boolean;
		} = {},
	): void {
		this.updateEmitter.notifyDataUpdate(context);
	}

	private beginIndexing(): void {
		this.runState.begin();
	}

	private endIndexing(): void {
		this.runState.end();
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
