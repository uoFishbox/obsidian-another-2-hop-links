import type { TFile } from "obsidian";

import { collectLinkReferences } from "core/indexing/metadata/metadataExtractor";
import { getLookupPathForLink } from "core/indexing/link-resolution/linkResolution";
import type { IIndexingService } from "types/services";
import type {
	CachedMetadataWithLinkReferences,
	DisplayDataVersions,
	ResolvePhase,
	ResolveProgress,
	TwoHopIndexedLink,
	TwoHopLinkResult,
} from "types/domain";
import type { IMetadataCache } from "types/obsidian";
import { enableLogging, logger } from "shared/logging/logger";
import { ResolverCache } from "./ResolverCache";
import {
	collectResolverDependencies,
	createTwoHopResolveSnapshot,
	type TwoHopResolveSnapshot,
} from "./ResolverDependencies";
import { TwoHopBranchBuilder } from "./TwoHopBranchBuilder";
import type { ResolverDebugPolicy, ResolverPerformanceSettings } from "./ResolverTypes";
import {
	createImmutableTaggedNotes,
	freezeTwoHopLinkResult,
} from "./immutableTwoHopLinkResult";
import { createResolveAbortError, throwIfResolveAborted } from "./resolveCancellation";

let nextDisplaySnapshotRevision = 0;

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
	private readonly supportsDataUpdateSubscription: boolean;
	private unsubscribeDataUpdate: (() => void) | undefined;
	private lastIndexVersion: number | undefined;

	constructor(
		private readonly metadataCache: IMetadataCache,
		private readonly indexingService: IIndexingService,
		private readonly getPerformanceSettingsOverride?: () => Partial<ResolverPerformanceSettings>,
		private readonly getDebugPolicy?: () => ResolverDebugPolicy,
	) {
		this.cache = new ResolverCache();
		this.branchBuilder = new TwoHopBranchBuilder(metadataCache, indexingService);

		if (typeof indexingService.onDataUpdate === "function") {
			this.supportsDataUpdateSubscription = true;
			this.unsubscribeDataUpdate = indexingService.onDataUpdate((context) => {
				this.cache.invalidate(context);
			});
		} else {
			this.supportsDataUpdateSubscription = false;
			this.unsubscribeDataUpdate = undefined;
		}
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
			if (this.supportsDataUpdateSubscription) {
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
			}

			await this.indexingService.awaitIdle();
			throwIfResolveAborted(signal);
			const indexVersion = this.indexingService.getIndexVersion();

			if (!this.supportsDataUpdateSubscription) {
				if (
					this.lastIndexVersion !== undefined &&
					this.lastIndexVersion !== indexVersion
				) {
					this.cache.clear();
				}
				this.lastIndexVersion = indexVersion;
			}

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

			const displaySnapshotRevision = ++nextDisplaySnapshotRevision;
			const cache = this.metadataCache.getFileCache(
				targetFile,
			) as CachedMetadataWithLinkReferences | null;
			const outgoingLinks = collectLinkReferences(cache);

			const enableCanvasBacklinkDebug =
				this.getDebugPolicy?.().enableCanvasBacklinkDebug ?? false;
			this.logCanvasDebugHeader(targetFile, enableCanvasBacklinkDebug);

			const indexedBacklinks =
				this.indexingService.getUniqueBacklinkSourcesForLink(
					targetFile.path,
					targetFile.path,
				);
			this.logCanvasBacklinks(indexedBacklinks, enableCanvasBacklinkDebug);
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
				displayVersions: this.createDisplayVersions(
					displaySnapshotRevision,
					"base",
				),
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
				displayVersions: this.createDisplayVersions(
					displaySnapshotRevision,
					"twohop",
				),
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
				displayVersions: this.createDisplayVersions(
					displaySnapshotRevision,
					"complete",
					resolveSettings.includeTaggedNotes,
				),
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
				indexVersion,
				performanceSettings,
				resolveSettings,
				dependencies,
				result,
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

	private createDisplayVersions(
		displaySnapshotRevision: number,
		phase: ResolvePhase,
		includeTaggedNotes = true,
	): DisplayDataVersions {
		const versionPrefix = String(displaySnapshotRevision);
		switch (phase) {
			case "base":
				return {
					links: `${versionPrefix}:base`,
					tags: `${versionPrefix}:pending`,
				};
			case "twohop":
				return {
					links: `${versionPrefix}:twohop`,
					tags: `${versionPrefix}:pending`,
				};
			case "complete":
				return {
					links: `${versionPrefix}:twohop`,
					tags: `${versionPrefix}:${includeTaggedNotes ? "tags" : "hidden"}`,
				};
		}
	}

	private logCanvasDebugHeader(
		targetFile: TFile,
		enableCanvasBacklinkDebug: boolean,
	): void {
		if (!enableCanvasBacklinkDebug) {
			return;
		}
		if (enableLogging)
			logger(
				`[DEBUG_CANVAS] TwoHopLinkResolver.resolve called for: ${targetFile.path}`,
			);
		if (enableLogging)
			logger(
				`[DEBUG_CANVAS]   Target is canvas: ${targetFile.extension === "canvas"}`,
			);
	}

	private logCanvasBacklinks(
		uniqueBacklinks: readonly Readonly<TwoHopIndexedLink>[],
		enableCanvasBacklinkDebug: boolean,
	): void {
		if (!enableCanvasBacklinkDebug) {
			return;
		}
		if (enableLogging)
			logger(
				`[DEBUG_CANVAS]   Unique backlinks after dedupe: ${uniqueBacklinks.length}`,
			);
		const canvasBacklinks = uniqueBacklinks.filter(
			(link) => link.sourceFile.extension === "canvas",
		);
		if (enableLogging)
			logger(
				`[DEBUG_CANVAS]   Backlinks from canvas files: ${canvasBacklinks.length}`,
			);
		if (canvasBacklinks.length === 0) {
			return;
		}
		canvasBacklinks.forEach((link, index) => {
			if (enableLogging)
				logger(
					`[DEBUG_CANVAS]     Canvas backlink ${index + 1}: ${link.sourceFile.path} -> ${link.rawText}`,
				);
		});
	}
}
