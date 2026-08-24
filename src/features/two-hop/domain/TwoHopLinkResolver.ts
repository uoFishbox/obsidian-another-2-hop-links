import type { TFile } from "obsidian";

import { collectLinkReferences } from "core/indexing/metadata/metadataExtractor";
import { getLookupPathForLink } from "core/indexing/link-resolution/linkResolution";
import type { IIndexingService } from "types/services";
import type {
	CachedMetadataWithLinkReferences,
	ResolveProgress,
	TaggedNote,
	TwoHopIndexedLink,
	TwoHopLinkResult,
} from "types/domain";
import type { IMetadataCache } from "types/obsidian";
import { ResolverCache } from "./ResolverCache";
import {
	collectResolverDependencies,
	createResolveAbortError,
	createTwoHopResolveSnapshot,
	throwIfResolveAborted,
	type ResolverPerformanceSettings,
	type TwoHopResolveSnapshot,
} from "./ResolverDependencies";
import { TwoHopBranchBuilder } from "./TwoHopBranchBuilder";

/**
 * Maximum number of times `resolveInternal` retries when the index version
 * changes mid-build. Prevents an unbounded loop when the index is updated
 * continuously; the last built snapshot is returned as a consistent fallback.
 */
const MAX_RESOLVE_RETRY_COUNT = 4;

export interface ResolveOptions {
	includeTaggedNotes?: boolean;
	signal?: AbortSignal;
}

interface ResolveSettings {
	readonly includeTaggedNotes: boolean;
}

interface InFlightResolve {
	readonly requestKey: string;
	readonly controller: AbortController;
	readonly promise: Promise<TwoHopResolveSnapshot>;
	readonly consumers: Set<symbol>;
	readonly listeners: Map<symbol, (progress: ResolveProgress) => void>;
	lastProgress: ResolveProgress | undefined;
	settled: boolean;
}

export class TwoHopLinkResolver {
	private readonly cache: ResolverCache;
	private readonly branchBuilder: TwoHopBranchBuilder;
	private readonly inFlightResolves = new Map<string, InFlightResolve>();
	private unsubscribeDataUpdate: (() => void) | undefined;

	constructor(
		private readonly metadataCache: IMetadataCache,
		private readonly indexingService: IIndexingService,
		private readonly getPerformanceSettingsOverride?: () => Partial<ResolverPerformanceSettings>,
	) {
		this.cache = new ResolverCache();
		this.branchBuilder = new TwoHopBranchBuilder(metadataCache, indexingService);

		this.unsubscribeDataUpdate = indexingService.onDataUpdate((context) => {
			this.cache.invalidate(context);
		});
	}

	public destroy(): void {
		for (const inFlight of this.inFlightResolves.values()) {
			inFlight.controller.abort();
		}
		this.inFlightResolves.clear();
		if (this.unsubscribeDataUpdate) {
			this.unsubscribeDataUpdate();
			this.unsubscribeDataUpdate = undefined;
		}
	}

	public async resolve(
		targetFile: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopLinkResult> {
		const snapshot = await this.resolveSnapshot(targetFile, onProgress, options);
		return snapshot.result;
	}

	public async resolveSnapshot(
		targetFile: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopResolveSnapshot> {
		throwIfResolveAborted(options?.signal);
		const performanceSettings = this.getPerformanceSettings();
		const resolveSettings = this.getResolveSettings(options);
		const requestKey = this.createResolveRequestKey(
			targetFile.path,
			performanceSettings,
			resolveSettings,
		);
		const inFlight = this.inFlightResolves.get(requestKey);
		if (inFlight) {
			return this.joinInFlightResolve(inFlight, onProgress, options?.signal);
		}

		const controller = new AbortController();
		let progressBeforeRegistration: ResolveProgress | undefined;
		const resolvePromise = this.resolveInternal(
			targetFile,
			performanceSettings,
			resolveSettings,
			(progress) => {
				const current = this.inFlightResolves.get(requestKey);
				if (!current) {
					progressBeforeRegistration = progress;
					return;
				}
				current.lastProgress = progress;
				for (const listener of current.listeners.values()) {
					listener(progress);
				}
			},
			controller.signal,
		);
		const createdInFlight: InFlightResolve = {
			requestKey,
			controller,
			promise: resolvePromise,
			consumers: new Set(),
			listeners: new Map(),
			lastProgress: progressBeforeRegistration,
			settled: false,
		};
		this.inFlightResolves.set(requestKey, createdInFlight);
		void resolvePromise.then(
			() => {
				createdInFlight.settled = true;
				if (this.inFlightResolves.get(requestKey) === createdInFlight) {
					this.inFlightResolves.delete(requestKey);
				}
			},
			() => {
				createdInFlight.settled = true;
				if (this.inFlightResolves.get(requestKey) === createdInFlight) {
					this.inFlightResolves.delete(requestKey);
				}
			},
		);

		return this.joinInFlightResolve(createdInFlight, onProgress, options?.signal);
	}

	private joinInFlightResolve(
		inFlight: InFlightResolve,
		onProgress: ((progress: ResolveProgress) => void) | undefined,
		signal: AbortSignal | undefined,
	): Promise<TwoHopResolveSnapshot> {
		throwIfResolveAborted(signal);
		const consumerId = Symbol("two-hop-resolve-consumer");
		inFlight.consumers.add(consumerId);
		if (onProgress) {
			inFlight.listeners.set(consumerId, onProgress);
			if (inFlight.lastProgress) {
				onProgress(inFlight.lastProgress);
			}
		}

		return new Promise<TwoHopResolveSnapshot>((resolve, reject) => {
			let consumerSettled = false;
			const releaseConsumer = (): void => {
				if (consumerSettled) return;
				consumerSettled = true;
				signal?.removeEventListener("abort", handleAbort);
				inFlight.consumers.delete(consumerId);
				inFlight.listeners.delete(consumerId);
				if (inFlight.settled || inFlight.consumers.size > 0) return;
				if (this.inFlightResolves.get(inFlight.requestKey) === inFlight) {
					this.inFlightResolves.delete(inFlight.requestKey);
				}
				inFlight.controller.abort();
			};
			const handleAbort = (): void => {
				releaseConsumer();
				reject(createResolveAbortError());
			};

			signal?.addEventListener("abort", handleAbort, { once: true });
			if (signal?.aborted) {
				handleAbort();
				return;
			}
			void inFlight.promise.then(
				(result) => {
					releaseConsumer();
					resolve(result);
				},
				(error: unknown) => {
					releaseConsumer();
					reject(error);
				},
			);
		});
	}

	private async resolveInternal(
		targetFile: TFile,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: ResolveSettings,
		onProgress?: (progress: ResolveProgress) => void,
		signal?: AbortSignal,
	): Promise<TwoHopResolveSnapshot> {
		for (let retryCount = 0; ; retryCount += 1) {
			throwIfResolveAborted(signal);
			const warmSnapshot = this.cache.getSnapshot(
				targetFile.path,
				performanceSettings,
				resolveSettings,
			);
			if (warmSnapshot) {
				onProgress?.({
					phase: "complete",
					data: warmSnapshot.result,
				});
				return warmSnapshot;
			}

			await this.indexingService.awaitIdle();
			throwIfResolveAborted(signal);
			const indexVersion = this.indexingService.getIndexVersion();

			const cachedSnapshot = this.cache.getSnapshot(
				targetFile.path,
				performanceSettings,
				resolveSettings,
			);
			if (cachedSnapshot) {
				onProgress?.({
					phase: "complete",
					data: cachedSnapshot.result,
				});
				return cachedSnapshot;
			}

			const cache = this.metadataCache.getFileCache(
				targetFile,
			) as CachedMetadataWithLinkReferences | null;
			const outgoingLinks = collectLinkReferences(cache);

			const indexedBacklinks =
				this.indexingService.getUniqueBacklinkSourcesForLink(
					targetFile.path,
					targetFile.path,
				);
			const uniqueBacklinks = this.addBacklinkCounts(indexedBacklinks);
			const baseBranches = await this.branchBuilder.buildHop1OnlyBranches(
				targetFile,
				outgoingLinks,
				performanceSettings,
				signal,
			);
			const baseResult = freezeTwoHopLinkResult({
				originFile: targetFile,
				branches: baseBranches,
				backlinks: uniqueBacklinks,
				taggedNotes: [],
			});
			onProgress?.({
				phase: "base",
				data: baseResult,
			});
			throwIfResolveAborted(signal);

			await Promise.resolve();
			throwIfResolveAborted(signal);
			const twoHopBranches = await this.branchBuilder.populateHop2(
				targetFile,
				baseBranches,
				performanceSettings,
				signal,
			);
			const twoHopResult = freezeTwoHopLinkResult({
				originFile: targetFile,
				branches: twoHopBranches,
				backlinks: uniqueBacklinks,
				taggedNotes: [],
			});
			onProgress?.({
				phase: "twohop",
				data: twoHopResult,
			});
			throwIfResolveAborted(signal);

			const taggedNotes = resolveSettings.includeTaggedNotes
				? createImmutableTaggedNotes(
						this.indexingService.peekNotesWithCommonTags(targetFile),
					)
				: [];

			const result = freezeTwoHopLinkResult({
				originFile: targetFile,
				branches: twoHopBranches,
				backlinks: uniqueBacklinks,
				taggedNotes,
			});
			throwIfResolveAborted(signal);

			if (this.indexingService.getIndexVersion() !== indexVersion) {
				if (retryCount >= MAX_RESOLVE_RETRY_COUNT) {
					// The index kept changing during the build. Return the last
					// consistent snapshot without caching, since it was built
					// against a stale index version.
					const dependencies = collectResolverDependencies(cache, result);
					const snapshot = createTwoHopResolveSnapshot(result, dependencies);
					onProgress?.({
						phase: "complete",
						data: result,
					});
					return snapshot;
				}
				continue;
			}

			const dependencies = collectResolverDependencies(cache, result);
			const snapshot = createTwoHopResolveSnapshot(result, dependencies);
			this.cache.set(
				targetFile.path,
				performanceSettings,
				resolveSettings,
				snapshot,
			);
			onProgress?.({
				phase: "complete",
				data: result,
			});

			return snapshot;
		}
	}

	private addBacklinkCounts(
		backlinks: readonly TwoHopIndexedLink[],
	): TwoHopIndexedLink[] {
		const linksWithBacklinkCounts = new Array<TwoHopIndexedLink>(backlinks.length);
		for (let index = 0; index < backlinks.length; index++) {
			const backlink = backlinks[index];
			if (!backlink.isUnresolved) {
				linksWithBacklinkCounts[index] = backlink;
				continue;
			}

			const lookupPath = getLookupPathForLink(backlink);
			linksWithBacklinkCounts[index] = {
				...backlink,
				backlinkCount: this.indexingService.getBacklinkCountForLink(lookupPath),
			};
		}
		return linksWithBacklinkCounts;
	}

	private getPerformanceSettings(): ResolverPerformanceSettings {
		const override = this.getPerformanceSettingsOverride?.();
		return {
			enableProgressiveTwoHopBuild:
				override?.enableProgressiveTwoHopBuild ?? true,
			maxOutgoingToProcess: Math.max(
				0,
				Math.floor(override?.maxOutgoingToProcess ?? 0),
			),
		};
	}

	private getResolveSettings(options?: ResolveOptions): ResolveSettings {
		return {
			includeTaggedNotes: options?.includeTaggedNotes ?? true,
		};
	}

	private createResolveRequestKey(
		filePath: string,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: ResolveSettings,
	): string {
		return `${filePath}\u0000${
			performanceSettings.enableProgressiveTwoHopBuild ? "1" : "0"
		}\u0000${performanceSettings.maxOutgoingToProcess}\u0000${
			resolveSettings.includeTaggedNotes ? "1" : "0"
		}`;
	}
}

/**
 * Freezes a resolver-owned result graph and returns it as one immutable snapshot.
 *
 * Obsidian values referenced by the graph (`TFile` and `Pos`) remain shared because
 * they are owned outside the resolver.
 */
export function freezeTwoHopLinkResult(result: TwoHopLinkResult): TwoHopLinkResult {
	for (const branch of result.branches) {
		freezeIndexedLink(branch.hop1);
		freezeIndexedLinks(branch.hop2);
		Object.freeze(branch);
	}
	Object.freeze(result.branches);
	freezeIndexedLinks(result.backlinks);

	for (const note of result.taggedNotes) {
		Object.freeze(note.commonTags);
		Object.freeze(note);
	}
	Object.freeze(result.taggedNotes);

	return Object.freeze(result);
}

/**
 * Copies tag-index values at the resolver boundary before they are frozen.
 */
export function createImmutableTaggedNotes(
	taggedNotes: readonly TaggedNote[],
): readonly Readonly<TaggedNote>[] {
	const snapshot = new Array<TaggedNote>(taggedNotes.length);
	for (let index = 0; index < taggedNotes.length; index += 1) {
		const note = taggedNotes[index];
		snapshot[index] = {
			...note,
			commonTags: note.commonTags.slice(),
		};
	}
	return snapshot;
}

function freezeIndexedLinks(links: readonly Readonly<TwoHopIndexedLink>[]): void {
	for (const link of links) {
		freezeIndexedLink(link);
	}
	Object.freeze(links);
}

function freezeIndexedLink(link: Readonly<TwoHopIndexedLink>): void {
	Object.freeze(link);
}
