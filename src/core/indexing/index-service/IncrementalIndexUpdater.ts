import { INDEXING_YIELD_INTERVAL_MS } from "../../../appConstants";
import {
	createBacklinkUpdater,
	type BacklinkUpdater,
	type BacklinkAdditionMutationCallback,
	type BacklinkReconcileSink,
	type BacklinkRemovalMutationCallback,
} from "core/indexing/backlink-builder/backlinkUpdater";
import { resolveFileByPath } from "shared/obsidian/resolveFileByPath";
import type { IMetadataCache, IVault } from "types/obsidian";
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
	IndexSnapshot,
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceSummary,
	TimeSlicingOptions,
} from "../types/IndexTypes";
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

interface IncrementalUpdateRunState {
	snapshot: IndexSnapshot;
	yieldScheduler: YieldScheduler;
	affectedLookupPaths: Set<string>;
	affectedPaths: Set<string>;
	affectedLookupKeys: Set<string>;
	affectedLinkSourcePaths: Set<string>;
	linkIndexChanged: boolean;
	resolvedMemo: ResolvedLinkMemo;
	localScratch: FileLocalAggregation;
	pathsToUpdate: Set<string>;
	pathsToDelete: Set<string>;
	createEventEvaluationCache?: CreateEventEvaluationCache;
	fastRenamePlans?: RenameFastPathPlan[];
	backlinkRemovalMutationCallback: BacklinkRemovalMutationCallback;
	backlinkAdditionMutationCallback: BacklinkAdditionMutationCallback;
	backlinkReconcileSink: BacklinkReconcileSink;
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
		snapshot: IndexSnapshot,
		changes: IncrementalFileChange[],
		options: TimeSlicingOptions = {},
	): Promise<IndexMutationResult> {
		const yieldScheduler = createYieldScheduler(
			options.yieldFn ?? defaultYieldToMainThread,
			options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS,
		);

		return this.applyInternalAsync(snapshot, changes, yieldScheduler);
	}

	private async applyInternalAsync(
		snapshot: IndexSnapshot,
		changes: IncrementalFileChange[],
		yieldScheduler: YieldScheduler,
	): Promise<IndexMutationResult> {
		const run = createIncrementalUpdateRunState(snapshot, yieldScheduler);

		await this.planChangesAsync(run, changes);
		this.applyAmbiguityChanges(changes);
		await this.applyDeletesAsync(run);
		await this.applyFastRenamesAsync(run);
		await this.applySourceUpdatesAsync(run);

		return {
			snapshot: run.snapshot,
			affectedPaths: run.affectedPaths,
			affectedLookupPaths: run.affectedLookupPaths,
			affectedLookupKeys: run.affectedLookupKeys,
			affectedLinkSourcePaths: run.affectedLinkSourcePaths,
			cacheInvalidationPaths: await collectCacheInvalidationPathsAsync(
				run.snapshot,
				run.affectedLookupPaths,
				run.affectedLookupKeys,
				run.yieldScheduler,
			),
			linkIndexChanged: run.linkIndexChanged,
		};
	}

	private async planChangesAsync(
		run: IncrementalUpdateRunState,
		changes: IncrementalFileChange[],
	): Promise<void> {
		let phaseChangeCount = 0;

		for (const change of changes) {
			if (change.type === "rename") {
				run.affectedPaths.add(change.oldPath);
				run.affectedPaths.add(change.newPath);
				const fastRenamePlan = await this.planRenameFastPathAsync(
					run.snapshot,
					change,
					run.yieldScheduler,
				);
				const createEventEvaluationCache = (run.createEventEvaluationCache ??=
					createCreateEventEvaluationCache());
				if (fastRenamePlan) {
					(run.fastRenamePlans ??= []).push(fastRenamePlan);
					run.pathsToDelete.add(change.oldPath);
					await this.createChangePlanner.collectPathsForCreateEventAsync(
						run.snapshot,
						change.newPath,
						run.pathsToUpdate,
						createEventEvaluationCache,
						run.yieldScheduler,
						{ includeCreatedPath: false },
					);
				} else {
					run.pathsToDelete.add(change.oldPath);
					await this.collectPathsForCreateEventAsync(
						run.snapshot,
						change.newPath,
						run.pathsToUpdate,
						createEventEvaluationCache,
						run.yieldScheduler,
					);
				}
			} else {
				run.affectedPaths.add(change.path);
				if (change.type === "delete") {
					run.pathsToDelete.add(change.path);
				} else if (change.type === "create") {
					const createEventEvaluationCache =
						(run.createEventEvaluationCache ??=
							createCreateEventEvaluationCache());
					await this.collectPathsForCreateEventAsync(
						run.snapshot,
						change.path,
						run.pathsToUpdate,
						createEventEvaluationCache,
						run.yieldScheduler,
					);
				} else if (change.type === "modify") {
					run.pathsToUpdate.add(change.path);
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

	private async applyDeletesAsync(run: IncrementalUpdateRunState): Promise<void> {
		let deleteCount = 0;
		for (const path of run.pathsToDelete) {
			const incomingSourceMap = run.snapshot.backlinksMap.get(path);
			if (incomingSourceMap) {
				let incomingCount = 0;
				for (const sourcePath of incomingSourceMap.keys()) {
					if (!run.pathsToDelete.has(sourcePath)) {
						run.pathsToUpdate.add(sourcePath);
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
				removeLookupPath(run.snapshot, path, run.affectedLookupKeys);
			}

			await this.backlinkUpdater.removeBacklinksBySourceAsync(
				run.snapshot.backlinksMap,
				path,
				run.snapshot.sourceSummaries.get(path),
				run.yieldScheduler,
				run.affectedLookupPaths,
				run.backlinkRemovalMutationCallback,
			);
			run.linkIndexChanged = true;
			run.affectedLinkSourcePaths.add(path);
			run.snapshot.backlinksMap.delete(path);
			await replaceSourceSummaryAsync(
				run.snapshot,
				path,
				undefined,
				run.yieldScheduler,
			);

			run.affectedLookupPaths.add(path);

			deleteCount++;
			const pendingYield = maybeYield(run.yieldScheduler, deleteCount, 1);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	private async applyFastRenamesAsync(run: IncrementalUpdateRunState): Promise<void> {
		const fastRenamePlans = run.fastRenamePlans;
		if (!fastRenamePlans) {
			return;
		}

		let fastRenameCount = 0;
		for (const fastRenamePlan of fastRenamePlans) {
			await this.backlinkUpdater.reconcileBacklinksBySourceAsync(
				run.snapshot.backlinksMap,
				fastRenamePlan.change.newPath,
				undefined,
				fastRenamePlan.movedSummary,
				run.yieldScheduler,
				undefined,
				run.backlinkAdditionMutationCallback,
				run.backlinkReconcileSink,
			);
			await replaceSourceSummaryAsync(
				run.snapshot,
				fastRenamePlan.change.newPath,
				fastRenamePlan.movedSummary,
				run.yieldScheduler,
			);
			run.affectedLookupPaths.add(fastRenamePlan.change.newPath);
			run.linkIndexChanged = true;
			run.affectedLinkSourcePaths.add(fastRenamePlan.change.newPath);

			fastRenameCount++;
			const pendingYield = maybeYield(run.yieldScheduler, fastRenameCount, 1);
			if (pendingYield) {
				await pendingYield;
			}
		}
	}

	private async applySourceUpdatesAsync(
		run: IncrementalUpdateRunState,
	): Promise<void> {
		let updateCount = 0;
		for (const path of run.pathsToUpdate) {
			run.affectedPaths.add(path);
			const file = resolveFileByPath(this.vault, path);
			if (!file) {
				continue;
			}

			const previousSummary = run.snapshot.sourceSummaries.get(path);
			const nextSummary =
				await this.backlinkUpdater.buildSourceSummaryForFileAsync(
					file,
					this.ambiguityDetector,
					run.yieldScheduler,
					run.resolvedMemo,
					run.localScratch,
				);

			const sourceSummaryChanged =
				await this.backlinkUpdater.reconcileBacklinksBySourceAsync(
					run.snapshot.backlinksMap,
					path,
					previousSummary,
					nextSummary,
					run.yieldScheduler,
					run.backlinkRemovalMutationCallback,
					run.backlinkAdditionMutationCallback,
					run.backlinkReconcileSink,
				);

			if (sourceSummaryChanged) {
				run.affectedLinkSourcePaths.add(path);
				run.linkIndexChanged = true;
			}

			await replaceSourceSummaryAsync(
				run.snapshot,
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
		snapshot: IndexSnapshot,
		newFilePath: string,
		pathsToUpdate: Set<string>,
		createEventEvaluationCache: CreateEventEvaluationCache,
		yieldScheduler: YieldScheduler,
	): Promise<void> {
		await this.createChangePlanner.collectPathsForCreateEventAsync(
			snapshot,
			newFilePath,
			pathsToUpdate,
			createEventEvaluationCache,
			yieldScheduler,
		);
	}

	private async planRenameFastPathAsync(
		snapshot: IndexSnapshot,
		change: Extract<IncrementalFileChange, { type: "rename" }>,
		yieldScheduler: YieldScheduler,
	): Promise<RenameFastPathPlan | undefined> {
		const previousSummary = snapshot.sourceSummaries.get(change.oldPath);
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

function createIncrementalUpdateRunState(
	snapshot: IndexSnapshot,
	yieldScheduler: YieldScheduler,
): IncrementalUpdateRunState {
	const affectedLookupPaths = new Set<string>();
	const affectedLookupKeys = new Set<string>();

	return {
		snapshot,
		yieldScheduler,
		affectedLookupPaths,
		affectedPaths: new Set(),
		affectedLookupKeys,
		affectedLinkSourcePaths: new Set(),
		linkIndexChanged: false,
		resolvedMemo: createResolvedLinkMemo(),
		localScratch: createFileLocalAggregation(),
		pathsToUpdate: new Set(),
		pathsToDelete: new Set(),
		backlinkRemovalMutationCallback(
			lookupPath,
			lookupKey,
			_sourcePath,
			hadResolved,
			isLookupPathEmptyAfter,
		) {
			onRemoveSourceFromLookupPath(
				snapshot,
				lookupPath,
				lookupKey,
				hadResolved,
				isLookupPathEmptyAfter,
				affectedLookupKeys,
			);
		},
		backlinkAdditionMutationCallback(
			lookupPath,
			lookupKey,
			_sourcePath,
			_isNewSource,
			hadResolved,
			hasResolved,
		) {
			onAddEdge(
				snapshot,
				lookupPath,
				lookupKey,
				hadResolved,
				hasResolved,
				affectedLookupKeys,
			);
		},
		backlinkReconcileSink: {
			markAffectedDestination(destinationPath) {
				affectedLookupPaths.add(destinationPath);
			},
			markRepresentativeChangedLookupKey(lookupKey) {
				affectedLookupKeys.add(lookupKey);
			},
		},
	};
}

function getPathBasename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}
