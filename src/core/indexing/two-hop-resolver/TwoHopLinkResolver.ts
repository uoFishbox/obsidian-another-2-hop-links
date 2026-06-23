import type { TFile } from "obsidian";

import { collectLinkReferences } from "../metadata/metadataExtractor";
import { getLookupPathForLink } from "../link-resolution/linkResolution";
import type { IIndexingService } from "types/services";
import type {
	CachedMetadataWithLinkReferences,
	DisplayDataVersions,
	ResolvePhase,
	ResolveProgress,
	TwoHopIndexedLink,
	TwoHopLinkResult,
} from "types/domain";
import type { IMetadataCache, IVault } from "types/obsidian";
import { enableLogging, logger } from "utils/logger";
import { ResolverCache } from "./ResolverCache";
import { collectResolverDependencies } from "./ResolverDependencies";
import { TwoHopBranchBuilder } from "./TwoHopBranchBuilder";
import type { ResolverDebugPolicy, ResolverPerformanceSettings } from "./ResolverTypes";

export interface ResolveOptions {
	includeTaggedNotes?: boolean;
}

export class TwoHopLinkResolver {
	private readonly cache: ResolverCache;
	private readonly branchBuilder: TwoHopBranchBuilder;
	private readonly inFlightResolves = new Map<
		string,
		{
			promise: Promise<TwoHopLinkResult>;
			listeners: Set<(progress: ResolveProgress) => void>;
			lastProgress: ResolveProgress | undefined;
		}
	>();
	private readonly supportsDataUpdateSubscription: boolean;
	private unsubscribeDataUpdate: (() => void) | undefined;
	private lastIndexVersion: number | undefined;

	constructor(
		private readonly metadataCache: IMetadataCache,
		private readonly _vault: IVault,
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
		if (!this.unsubscribeDataUpdate) {
			return;
		}
		this.unsubscribeDataUpdate();
		this.unsubscribeDataUpdate = undefined;
	}

	public async resolve(
		targetFile: TFile,
		onProgress?: (progress: ResolveProgress) => void,
		options?: ResolveOptions,
	): Promise<TwoHopLinkResult> {
		const performanceSettings = this.getPerformanceSettings();
		const resolveSettings = this.getResolveSettings(options);
		const requestKey = this.createResolveRequestKey(
			targetFile.path,
			performanceSettings,
			resolveSettings,
		);
		const inFlight = this.inFlightResolves.get(requestKey);
		if (inFlight) {
			if (onProgress) {
				if (inFlight.lastProgress) {
					onProgress(inFlight.lastProgress);
				}
				inFlight.listeners.add(onProgress);
			}
			return inFlight.promise;
		}

		const listeners = new Set<(progress: ResolveProgress) => void>();
		if (onProgress) {
			listeners.add(onProgress);
		}
		const resolvePromise = this.resolveInternal(
			targetFile,
			performanceSettings,
			resolveSettings,
			(progress) => {
				const current = this.inFlightResolves.get(requestKey);
				if (!current) {
					return;
				}
				current.lastProgress = progress;
				for (const listener of current.listeners) {
					listener(progress);
				}
			},
		);
		this.inFlightResolves.set(requestKey, {
			promise: resolvePromise,
			listeners,
			lastProgress: undefined,
		});

		try {
			return await resolvePromise;
		} finally {
			if (this.inFlightResolves.get(requestKey)?.promise === resolvePromise) {
				this.inFlightResolves.delete(requestKey);
			}
		}
	}

	private async resolveInternal(
		targetFile: TFile,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: Required<ResolveOptions>,
		onProgress?: (progress: ResolveProgress) => void,
	): Promise<TwoHopLinkResult> {
		for (;;) {
			if (this.supportsDataUpdateSubscription) {
				const cachedResult = this.cache.get(
					targetFile.path,
					performanceSettings,
					resolveSettings,
				);
				if (cachedResult) {
					onProgress?.({
						phase: "complete",
						data: cachedResult,
					});
					return cachedResult;
				}
			}

			await this.indexingService.awaitIdle();
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

			const cachedResult = this.cache.get(
				targetFile.path,
				performanceSettings,
				resolveSettings,
			);
			if (cachedResult) {
				onProgress?.({
					phase: "complete",
					data: cachedResult,
				});
				return cachedResult;
			}

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
			);
			const baseResult: TwoHopLinkResult = {
				originFile: targetFile,
				branches: baseBranches,
				backlinks: uniqueBacklinks,
				taggedNotes: [],
				displayVersions: this.createDisplayVersions(indexVersion, "base"),
			};
			onProgress?.({
				phase: "base",
				data: baseResult,
			});

			await Promise.resolve();
			const twoHopBranches = await this.branchBuilder.populateHop2(
				targetFile,
				baseBranches,
				performanceSettings,
			);
			const twoHopResult: TwoHopLinkResult = {
				originFile: targetFile,
				branches: twoHopBranches,
				backlinks: uniqueBacklinks,
				taggedNotes: [],
				displayVersions: this.createDisplayVersions(indexVersion, "twohop"),
			};
			onProgress?.({
				phase: "twohop",
				data: twoHopResult,
			});

			const taggedNotes = resolveSettings.includeTaggedNotes
				? this.indexingService.peekNotesWithCommonTags(targetFile)
				: [];

			const result: TwoHopLinkResult = {
				originFile: targetFile,
				branches: twoHopBranches,
				backlinks: uniqueBacklinks,
				taggedNotes,
				displayVersions: this.createDisplayVersions(
					indexVersion,
					"complete",
					resolveSettings.includeTaggedNotes,
				),
			};

			if (this.indexingService.getIndexVersion() !== indexVersion) {
				continue;
			}

			const dependencies = collectResolverDependencies(
				this.metadataCache,
				result,
			);
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

			return result;
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
			maxHop2PerBranch: Math.max(0, Math.floor(override?.maxHop2PerBranch ?? 0)),
		};
	}

	private getResolveSettings(options?: ResolveOptions): Required<ResolveOptions> {
		return {
			includeTaggedNotes: options?.includeTaggedNotes ?? true,
		};
	}

	private createResolveRequestKey(
		filePath: string,
		performanceSettings: ResolverPerformanceSettings,
		resolveSettings: Required<ResolveOptions>,
	): string {
		return `${filePath}\u0000${
			performanceSettings.enableProgressiveTwoHopBuild ? "1" : "0"
		}\u0000${performanceSettings.maxOutgoingToProcess}\u0000${
			performanceSettings.maxHop2PerBranch
		}\u0000${resolveSettings.includeTaggedNotes ? "1" : "0"}`;
	}

	private createDisplayVersions(
		indexVersion: number,
		phase: ResolvePhase,
		includeTaggedNotes = true,
	): DisplayDataVersions {
		const versionPrefix = String(indexVersion);
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
