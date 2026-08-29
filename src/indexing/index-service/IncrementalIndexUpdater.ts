import { INDEXING_YIELD_INTERVAL_MS } from "indexing/config";
import {
	createBacklinkUpdater,
	type BacklinkUpdater,
	type BacklinkReconcileSink,
} from "indexing/backlink-builder/backlinkUpdater";
import { resolveFileByPath } from "obsidian-integration/files/resolveFileByPath";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import {
	createCreateChangePlanner,
	createCreateEventEvaluationCache,
	type CreateChangePlanner,
	type CreateEventEvaluationCache,
} from "./createChangePlanner";
import {
	collectCacheInvalidationPathsAsync,
	onAddEdge,
	onRemoveSourceFromLookupPath,
	removeLookupPath,
	replaceSourceSummaryAsync,
} from "../backlink-builder/lookupGraphMutator";
import {
	createLinkResolutionAmbiguityDetector,
	toCaseInsensitiveLookupKey,
	type MutableLinkResolutionAmbiguityDetector,
} from "../link-resolution/linkResolution";
import {
	createResolvedLinkMemo,
	type ResolvedLinkMemo,
} from "../backlink-builder/backlinkReferenceSequence";
import {
	createFileLocalAggregation,
	type FileLocalAggregation,
} from "../backlink-builder/backlinkAggregation";
import type {
	IncrementalFileChange,
	IndexMutationResult,
	MutableIndexState,
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceSummary,
	TimeSlicingOptions,
} from "../indexState";
import {
	createYieldScheduler,
	defaultYieldToMainThread,
	HEAVY_YIELD_CHECK_INTERVAL,
	maybeYield,
	type YieldScheduler,
} from "../timeSlicing";

interface RenameFastPathPlan {
	change: Extract<IncrementalFileChange, { type: "rename" }>;
	movedSummary: SourceSummary;
}

class IncrementalUpdateRun implements BacklinkReconcileSink {
	readonly changedDestinationPaths = new Set<string>();
	readonly changedFilePaths = new Set<string>();
	readonly changedLookupKeys = new Set<string>();
	readonly changedLinkSourcePaths = new Set<string>();
	readonly sourcePathsToReindex = new Set<string>();
	readonly sourcePathsToRemove = new Set<string>();
	linkIndexChanged = false;
	readonly resolvedMemo = createResolvedLinkMemo();
	readonly localScratch = createFileLocalAggregation();
	createEventEvaluationCache?: CreateEventEvaluationCache;
	fastRenamePlans?: RenameFastPathPlan[];

	constructor(
		readonly state: MutableIndexState,
		readonly yieldScheduler: YieldScheduler,
	) {}

	onBacklinkRemoved(
		lookupPath: string,
		lookupKey: string,
		_sourcePath: string,
		hadResolved: boolean,
		isLookupPathEmptyAfter: boolean,
	): void {
		onRemoveSourceFromLookupPath(
			this.state,
			lookupPath,
			lookupKey,
			hadResolved,
			isLookupPathEmptyAfter,
			this.changedLookupKeys,
		);
	}

	onBacklinkAdded(
		lookupPath: string,
		lookupKey: string,
		_sourcePath: string,
		_isNewSource: boolean,
		hadResolved: boolean,
		hasResolved: boolean,
	): void {
		onAddEdge(
			this.state,
			lookupPath,
			lookupKey,
			hadResolved,
			hasResolved,
			this.changedLookupKeys,
		);
	}

	markAffectedDestination(destinationPath: string): void {
		this.changedDestinationPaths.add(destinationPath);
	}

	markRepresentativeChangedLookupKey(lookupKey: string): void {
		this.changedLookupKeys.add(lookupKey);
	}
}

export class IncrementalIndexUpdater {
	private readonly backlinkUpdater: BacklinkUpdater;
	private readonly createChangePlanner: CreateChangePlanner;

	constructor(
		private readonly vault: IVault,
		private readonly metadataCache: IMetadataCache,
		private readonly ambiguityDetector: MutableLinkResolutionAmbiguityDetector = createLinkResolutionAmbiguityDetector(
			vault,
		),
	) {
		this.backlinkUpdater = createBacklinkUpdater(vault, metadataCache);
		this.createChangePlanner = createCreateChangePlanner(vault, metadataCache);
	}

	public async applyAsync(
		state: MutableIndexState,
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<IndexMutationResult> {
		const yieldScheduler = createYieldScheduler(
			options.yieldFn ?? defaultYieldToMainThread,
			options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
		);

		return this.applyInternalAsync(state, changes, yieldScheduler);
	}

	private async applyInternalAsync(
		state: MutableIndexState,
		changes: IncrementalFileChange[],
		yieldScheduler: YieldScheduler,
	): Promise<IndexMutationResult> {
		const run = new IncrementalUpdateRun(state, yieldScheduler);

		await this.planChangesAsync(run, changes);
		this.applyAmbiguityChanges(changes);
		await this.applyDeletesAsync(run);
		await this.applyFastRenamesAsync(run);
		await this.applySourceUpdatesAsync(run);

		return {
			snapshot: run.state,
			changedFilePaths: run.changedFilePaths,
			changedDestinationPaths: run.changedDestinationPaths,
			changedLookupKeys: run.changedLookupKeys,
			changedLinkSourcePaths: run.changedLinkSourcePaths,
			cacheInvalidationPaths: await collectCacheInvalidationPathsAsync(
				run.state,
				run.changedDestinationPaths,
				run.changedLookupKeys,
				run.yieldScheduler,
			),
			linkIndexChanged: run.linkIndexChanged,
		};
	}

	private async planChangesAsync(
		run: IncrementalUpdateRun,
		changes: IncrementalFileChange[],
	): Promise<void> {
		let phaseChangeCount = 0;

		for (const change of changes) {
			switch (change.type) {
				case "rename": {
					run.changedFilePaths.add(change.oldPath);
					run.changedFilePaths.add(change.newPath);
					run.sourcePathsToRemove.add(change.oldPath);

					const fastRenamePlan = await this.planRenameFastPathAsync(
						run.state,
						change,
						run.yieldScheduler,
					);
					const createEventEvaluationCache =
						(run.createEventEvaluationCache ??=
							createCreateEventEvaluationCache());

					if (fastRenamePlan) {
						(run.fastRenamePlans ??= []).push(fastRenamePlan);
						await this.createChangePlanner.collectPathsForCreateEventAsync(
							run.state,
							change.newPath,
							run.sourcePathsToReindex,
							createEventEvaluationCache,
							run.yieldScheduler,
							{ includeCreatedPath: false },
						);
					} else {
						await this.collectPathsForCreateEventAsync(
							run.state,
							change.newPath,
							run.sourcePathsToReindex,
							createEventEvaluationCache,
							run.yieldScheduler,
						);
					}
					break;
				}
				case "delete":
					run.changedFilePaths.add(change.path);
					run.sourcePathsToRemove.add(change.path);
					break;
				case "create": {
					run.changedFilePaths.add(change.path);
					const createEventEvaluationCache =
						(run.createEventEvaluationCache ??=
							createCreateEventEvaluationCache());
					await this.collectPathsForCreateEventAsync(
						run.state,
						change.path,
						run.sourcePathsToReindex,
						createEventEvaluationCache,
						run.yieldScheduler,
					);
					break;
				}
				case "modify":
					run.changedFilePaths.add(change.path);
					run.sourcePathsToReindex.add(change.path);
					break;
				default: {
					const _exhaustive: never = change;
					return _exhaustive;
				}
			}

			phaseChangeCount++;
			const pendingYield = maybeYield(run.yieldScheduler, phaseChangeCount, 8);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	private applyAmbiguityChanges(changes: IncrementalFileChange[]): void {
		for (const change of changes) {
			if (change.type === "rename") {
				this.ambiguityDetector.removePath(change.oldPath);
				this.ambiguityDetector.addPath(change.newPath);
			} else if (change.type === "delete") {
				this.ambiguityDetector.removePath(change.path);
			} else if (change.type === "create") {
				this.ambiguityDetector.addPath(change.path);
			}
		}
	}

	private async applyDeletesAsync(run: IncrementalUpdateRun): Promise<void> {
		let deleteCount = 0;
		for (const path of run.sourcePathsToRemove) {
			const incomingSourceMap = run.state.backlinksMap.get(path);
			if (incomingSourceMap) {
				let incomingCount = 0;
				for (const sourcePath of incomingSourceMap.keys()) {
					if (!run.sourcePathsToRemove.has(sourcePath)) {
						run.sourcePathsToReindex.add(sourcePath);
					}

					incomingCount++;
					const pendingYield = maybeYield(
						run.yieldScheduler,
						incomingCount,
						HEAVY_YIELD_CHECK_INTERVAL,
					);
					if (pendingYield) {
						await pendingYield;
					}
				}
				removeLookupPath(run.state, path, run.changedLookupKeys);
			}

			await this.backlinkUpdater.removeBacklinksBySourceIntoAsync(
				run.state.backlinksMap,
				path,
				run.state.sourceSummaries.get(path),
				run.yieldScheduler,
				run,
			);
			run.linkIndexChanged = true;
			run.changedLinkSourcePaths.add(path);
			run.state.backlinksMap.delete(path);
			await replaceSourceSummaryAsync(
				run.state,
				path,
				undefined,
				run.yieldScheduler,
			);

			run.changedDestinationPaths.add(path);

			deleteCount++;
			const pendingYield = maybeYield(run.yieldScheduler, deleteCount, 1);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	private async applyFastRenamesAsync(run: IncrementalUpdateRun): Promise<void> {
		const fastRenamePlans = run.fastRenamePlans;
		if (!fastRenamePlans) {
			return;
		}

		let fastRenameCount = 0;
		for (const fastRenamePlan of fastRenamePlans) {
			await this.backlinkUpdater.reconcileBacklinksBySourceIntoAsync(
				run.state.backlinksMap,
				fastRenamePlan.change.newPath,
				undefined,
				fastRenamePlan.movedSummary,
				run.yieldScheduler,
				run,
			);
			await replaceSourceSummaryAsync(
				run.state,
				fastRenamePlan.change.newPath,
				fastRenamePlan.movedSummary,
				run.yieldScheduler,
			);
			run.changedDestinationPaths.add(fastRenamePlan.change.newPath);
			run.linkIndexChanged = true;
			run.changedLinkSourcePaths.add(fastRenamePlan.change.newPath);

			fastRenameCount++;
			const pendingYield = maybeYield(run.yieldScheduler, fastRenameCount, 1);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	private async applySourceUpdatesAsync(run: IncrementalUpdateRun): Promise<void> {
		let updateCount = 0;
		for (const path of run.sourcePathsToReindex) {
			run.changedFilePaths.add(path);
			const file = resolveFileByPath(this.vault, path);
			if (!file) {
				continue;
			}

			const previousSummary = run.state.sourceSummaries.get(path);
			const nextSummary =
				await this.backlinkUpdater.buildSourceSummaryForFileAsync(
					file,
					this.ambiguityDetector,
					run.yieldScheduler,
					run.resolvedMemo,
					run.localScratch,
				);

			const sourceSummaryChanged =
				await this.backlinkUpdater.reconcileBacklinksBySourceIntoAsync(
					run.state.backlinksMap,
					path,
					previousSummary,
					nextSummary,
					run.yieldScheduler,
					run,
				);

			if (sourceSummaryChanged) {
				run.changedLinkSourcePaths.add(path);
				run.linkIndexChanged = true;
			}

			await replaceSourceSummaryAsync(
				run.state,
				path,
				nextSummary,
				run.yieldScheduler,
			);

			updateCount++;
			const pendingYield = maybeYield(run.yieldScheduler, updateCount, 1);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	private async collectPathsForCreateEventAsync(
		state: MutableIndexState,
		newFilePath: string,
		sourcePathsToReindex: Set<string>,
		createEventEvaluationCache: CreateEventEvaluationCache,
		yieldScheduler: YieldScheduler,
	): Promise<void> {
		await this.createChangePlanner.collectPathsForCreateEventAsync(
			state,
			newFilePath,
			sourcePathsToReindex,
			createEventEvaluationCache,
			yieldScheduler,
		);
	}

	private async planRenameFastPathAsync(
		state: MutableIndexState,
		change: Extract<IncrementalFileChange, { type: "rename" }>,
		yieldScheduler: YieldScheduler,
	): Promise<RenameFastPathPlan | undefined> {
		const previousSummary = state.sourceSummaries.get(change.oldPath);
		if (!this.canUseRenameFastPath(change, previousSummary) || !previousSummary) {
			return undefined;
		}

		return {
			change,
			movedSummary: await this.rehomeSourceSummaryAsync(
				previousSummary,
				change.oldPath,
				change.newPath,
				yieldScheduler,
			),
		};
	}

	private canUseRenameFastPath(
		change: Extract<IncrementalFileChange, { type: "rename" }>,
		summary: SourceSummary | undefined,
	): boolean {
		if (!summary) {
			return false;
		}
		if (getPathBasename(change.oldPath) !== getPathBasename(change.newPath)) {
			return false;
		}
		if (summary.hasSourceDependentLinks) {
			return false;
		}
		if (
			this.hasRenamePathSensitiveLookup(summary, change.oldPath, change.newPath)
		) {
			return false;
		}

		return resolveFileByPath(this.vault, change.newPath) !== null;
	}

	private hasRenamePathSensitiveLookup(
		summary: SourceSummary,
		oldPath: string,
		newPath: string,
	): boolean {
		const oldLookupKey = toCaseInsensitiveLookupKey(oldPath);
		const newLookupKey = toCaseInsensitiveLookupKey(newPath);

		return (
			summary.lookupEntries.has(oldLookupKey) ||
			summary.lookupEntries.has(newLookupKey)
		);
	}

	private async rehomeSourceSummaryAsync(
		summary: SourceSummary,
		oldPath: string,
		newPath: string,
		yieldScheduler: YieldScheduler,
	): Promise<SourceSummary> {
		let destinations: Map<string, SourceDestinationSummary> | undefined;

		let destinationCount = 0;
		for (const [destinationPath, destinationSummary] of summary.destinations) {
			if (destinationPath !== oldPath) {
				if (destinations) {
					destinations.set(destinationPath, destinationSummary);
				}
			} else {
				destinations = new Map(summary.destinations);
				destinations.delete(oldPath);
				destinations.set(newPath, destinationSummary);
			}

			destinationCount++;
			const pendingYield = maybeYield(
				yieldScheduler,
				destinationCount,
				HEAVY_YIELD_CHECK_INTERVAL,
			);
			if (pendingYield) {
				await pendingYield;
			}
		}

		const nextDestinations = destinations ?? summary.destinations;

		let orderedReferences: OrderedBacklinkRef[] | undefined;
		for (let index = 0; index < summary.orderedReferences.length; index++) {
			const ref = summary.orderedReferences[index];

			if (ref.destinationPath !== oldPath) {
				if (orderedReferences) {
					orderedReferences[index] = ref as OrderedBacklinkRef;
				}
				continue;
			}

			orderedReferences ??= summary.orderedReferences.slice(
				0,
				index,
			) as OrderedBacklinkRef[];
			orderedReferences[index] = {
				...ref,
				destinationPath: newPath,
			};

			const pendingYield = maybeYield(
				yieldScheduler,
				index + 1,
				HEAVY_YIELD_CHECK_INTERVAL,
			);
			if (pendingYield) {
				await pendingYield;
			}
		}

		const nextOrderedReferences = orderedReferences ?? summary.orderedReferences;

		return {
			destinations: nextDestinations,
			orderedReferences: nextOrderedReferences,
			lookupEntries: summary.lookupEntries,
			hasSourceDependentLinks: summary.hasSourceDependentLinks,
		};
	}
}

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}
