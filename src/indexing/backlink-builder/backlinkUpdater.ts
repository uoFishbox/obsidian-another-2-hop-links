import type { IVault, IMetadataCache } from "obsidian-integration/hostContracts";
import { TFile } from "obsidian";
import type {
	BacklinkBucket,
	BacklinksMap,
	CachedMetadataWithLinkReferences,
} from "indexing/model";
import {
	createLinkResolutionAmbiguityDetector,
	type LinkResolutionAmbiguityDetector,
	toCaseInsensitiveLookupKey,
} from "../link-resolution/linkResolution";
import type {
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceSummary,
} from "../indexState";
import {
	createResolvedLinkMemo,
	visitResolvedBacklinkRefsUnorderedAsync,
	type ResolvedLinkMemo,
} from "./backlinkReferenceSequence";
import {
	drainYieldSteps,
	HEAVY_YIELD_CHECK_INTERVAL,
	maybeYield,
	type YieldScheduler,
} from "../timeSlicing";
import {
	createFileLocalAggregation,
	createSourceSummaryFromAggregationChunked,
	recordFileLocalReference,
	resetFileLocalAggregation,
	type FileLocalAggregation,
} from "./backlinkAggregation";

export type BacklinkRemovalMutationCallback = (
	lookupPath: string,
	lookupKey: string,
	sourcePath: string,
	hadResolved: boolean,
	isLookupPathEmptyAfter: boolean,
) => void;

export type BacklinkAdditionMutationCallback = (
	lookupPath: string,
	lookupKey: string,
	sourcePath: string,
	isNewSource: boolean,
	hadResolved: boolean,
	hasResolved: boolean,
) => void;

/** Receives changes to the lookup graph while a source is reconciled. */
export interface BacklinkMutationSink {
	onBacklinkRemoved(
		lookupPath: string,
		lookupKey: string,
		sourcePath: string,
		hadResolved: boolean,
		isLookupPathEmptyAfter: boolean,
	): void;
	onBacklinkAdded(
		lookupPath: string,
		lookupKey: string,
		sourcePath: string,
		isNewSource: boolean,
		hadResolved: boolean,
		hasResolved: boolean,
	): void;
}

export interface BacklinkReconcileResult {
	changedDestinationPaths: Set<string>;
	changedRepresentativeLookupKeys: Set<string>;
	sourceSummaryChanged: boolean;
}

/**
 * Receives reconcile effects without allocating per-source result Sets.
 */
export interface BacklinkReconcileEffectsSink {
	markAffectedDestination(destinationPath: string): void;
	markRepresentativeChangedLookupKey(lookupKey: string): void;
}

/** Receives both graph mutations and summary-level reconcile effects. */
export interface BacklinkReconcileSink
	extends BacklinkMutationSink, BacklinkReconcileEffectsSink {}

function areSourceDestinationsEqual(
	left: SourceDestinationSummary,
	right: SourceDestinationSummary,
): boolean {
	return left.count === right.count && left.hasResolved === right.hasResolved;
}

function getRepresentativeRefByDestination(
	summary: SourceSummary,
	destinationPath: string,
): OrderedBacklinkRef | undefined {
	const destination = summary.destinations.get(destinationPath);
	if (!destination) {
		return undefined;
	}
	return summary.orderedReferences[destination.firstRefIndex];
}

function getRepresentativeRefByLookupKey(
	summary: SourceSummary,
	lookupKey: string,
): OrderedBacklinkRef | undefined {
	const lookupEntry = summary.lookupEntries.get(lookupKey);
	if (!lookupEntry) {
		return undefined;
	}
	return summary.orderedReferences[lookupEntry.firstRefIndex];
}

function areOrderedBacklinkRefsEqual(
	left: OrderedBacklinkRef | undefined,
	right: OrderedBacklinkRef | undefined,
): boolean {
	if (!left || !right) {
		return left === right;
	}

	return (
		left.destinationPath === right.destinationPath &&
		left.rawLookupKey === right.rawLookupKey &&
		left.isUnresolved === right.isUnresolved &&
		left.rawText === right.rawText
	);
}

function areDestinationRepresentativeRefsEqual(
	leftSummary: SourceSummary,
	rightSummary: SourceSummary,
	destinationPath: string,
): boolean {
	const left = getRepresentativeRefByDestination(leftSummary, destinationPath);
	const right = getRepresentativeRefByDestination(rightSummary, destinationPath);

	return areOrderedBacklinkRefsEqual(left, right);
}

function areLookupKeyRepresentativeRefsEqual(
	leftSummary: SourceSummary,
	rightSummary: SourceSummary,
	lookupKey: string,
): boolean {
	const left = getRepresentativeRefByLookupKey(leftSummary, lookupKey);
	const right = getRepresentativeRefByLookupKey(rightSummary, lookupKey);

	return areOrderedBacklinkRefsEqual(left, right);
}

async function visitRepresentativeChangedLookupKeysAsync(
	previousSummary: SourceSummary | undefined,
	nextSummary: SourceSummary | undefined,
	yieldScheduler: YieldScheduler,
	sink: BacklinkReconcileEffectsSink,
): Promise<boolean> {
	if (!previousSummary || !nextSummary) {
		return false;
	}

	let changed = false;
	let lookupKeyCount = 0;
	for (const lookupKey of previousSummary.lookupEntries.keys()) {
		if (!nextSummary.lookupEntries.has(lookupKey)) {
			continue;
		}

		if (
			!areLookupKeyRepresentativeRefsEqual(
				previousSummary,
				nextSummary,
				lookupKey,
			)
		) {
			sink.markRepresentativeChangedLookupKey(lookupKey);
			changed = true;
		}

		lookupKeyCount++;
		const pendingYield = maybeYield(
			yieldScheduler,
			lookupKeyCount,
			HEAVY_YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) {
			await pendingYield;
		}
	}

	return changed;
}

export interface BacklinkUpdater {
	/** Removes a source while streaming graph effects into the run sink. */
	removeBacklinksBySourceIntoAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		sourceSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		sink: BacklinkReconcileSink,
	): Promise<void>;

	removeBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		sourceSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		affectedDestinations: Set<string>,
		onMutation?: BacklinkRemovalMutationCallback,
	): Promise<void>;

	buildSourceSummaryForFileAsync(
		file: TFile,
		ambiguityDetector: LinkResolutionAmbiguityDetector | undefined,
		yieldScheduler: YieldScheduler,
		resolvedMemo?: ResolvedLinkMemo,
		localScratch?: FileLocalAggregation,
	): Promise<SourceSummary | undefined>;

	/** Collects reconcile effects into two result Sets. */
	reconcileBacklinksBySourceCollectingAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval?: BacklinkRemovalMutationCallback,
		onAddition?: BacklinkAdditionMutationCallback,
	): Promise<BacklinkReconcileResult>;

	/** Streams effects into a sink without allocating result Sets. */
	reconcileBacklinksBySourceIntoAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		sink: BacklinkReconcileSink,
	): Promise<boolean>;
}

export function createBacklinkUpdater(
	vault: IVault,
	metadataCache: IMetadataCache,
): BacklinkUpdater {
	function removeDestinationForSource(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		destinationPath: string,
		onMutation?: BacklinkRemovalMutationCallback,
		mutationSink?: BacklinkMutationSink,
	): boolean {
		const sourceMap = backlinksMap.get(destinationPath);
		if (!sourceMap) {
			return false;
		}

		const removed = sourceMap.get(sourcePath);
		if (!removed) {
			return false;
		}

		sourceMap.delete(sourcePath);
		const lookupKey = toCaseInsensitiveLookupKey(destinationPath);
		onMutation?.(
			destinationPath,
			lookupKey,
			sourcePath,
			removed.hasResolved,
			sourceMap.size === 0,
		);
		mutationSink?.onBacklinkRemoved(
			destinationPath,
			lookupKey,
			sourcePath,
			removed.hasResolved,
			sourceMap.size === 0,
		);

		if (sourceMap.size === 0) {
			backlinksMap.delete(destinationPath);
		}

		return true;
	}

	function addDestinationForSource(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		destinationPath: string,
		destinationSummary: SourceDestinationSummary,
		onMutation?: BacklinkAdditionMutationCallback,
		mutationSink?: BacklinkMutationSink,
	): boolean {
		let sourceMap = backlinksMap.get(destinationPath);
		if (!sourceMap) {
			sourceMap = new Map();
			backlinksMap.set(destinationPath, sourceMap);
		}
		const before = sourceMap.get(sourcePath);
		const hadResolved = before?.hasResolved ?? false;
		const after: BacklinkBucket = before
			? {
					count: before.count + destinationSummary.count,
					hasResolved: before.hasResolved || destinationSummary.hasResolved,
				}
			: destinationSummary;
		sourceMap.set(sourcePath, after);
		const lookupKey = toCaseInsensitiveLookupKey(destinationPath);
		onMutation?.(
			destinationPath,
			lookupKey,
			sourcePath,
			!before,
			hadResolved,
			after.hasResolved,
		);
		mutationSink?.onBacklinkAdded(
			destinationPath,
			lookupKey,
			sourcePath,
			!before,
			hadResolved,
			after.hasResolved,
		);
		return true;
	}

	async function removeBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		sourceSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		affectedDestinations: Set<string>,
		onMutation?: BacklinkRemovalMutationCallback,
	): Promise<void> {
		if (!sourceSummary) {
			return;
		}

		let destinationCount = 0;

		for (const destinationPath of sourceSummary.destinations.keys()) {
			if (
				removeDestinationForSource(
					backlinksMap,
					sourcePath,
					destinationPath,
					onMutation,
				)
			) {
				affectedDestinations.add(destinationPath);
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
	}

	async function removeBacklinksBySourceIntoAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		sourceSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		sink: BacklinkReconcileSink,
	): Promise<void> {
		if (!sourceSummary) {
			return;
		}

		let destinationCount = 0;
		for (const destinationPath of sourceSummary.destinations.keys()) {
			if (
				removeDestinationForSource(
					backlinksMap,
					sourcePath,
					destinationPath,
					undefined,
					sink,
				)
			) {
				sink.markAffectedDestination(destinationPath);
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
	}

	async function buildSourceSummaryForFileAsync(
		file: TFile,
		ambiguityDetector: LinkResolutionAmbiguityDetector | undefined,
		yieldScheduler: YieldScheduler,
		resolvedMemo: ResolvedLinkMemo = createResolvedLinkMemo(),
		localScratch: FileLocalAggregation = createFileLocalAggregation(),
	): Promise<SourceSummary | undefined> {
		const cache = metadataCache.getFileCache(
			file,
		) as CachedMetadataWithLinkReferences | null;
		const detector =
			ambiguityDetector ?? createLinkResolutionAmbiguityDetector(vault);
		resetFileLocalAggregation(localScratch);

		await visitResolvedBacklinkRefsUnorderedAsync(
			metadataCache,
			file,
			cache,
			detector,
			resolvedMemo,
			yieldScheduler,
			(linkReference, resolved, offset, rawLinkPath) => {
				recordFileLocalReference(
					localScratch,
					linkReference,
					resolved,
					offset,
					rawLinkPath,
				);
			},
			HEAVY_YIELD_CHECK_INTERVAL,
		);

		return drainYieldSteps(
			createSourceSummaryFromAggregationChunked(localScratch, yieldScheduler),
		);
	}

	async function reconcileBacklinksBySourceIntoAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		sink: BacklinkReconcileSink,
	): Promise<boolean> {
		const representativeChanged = await visitRepresentativeChangedLookupKeysAsync(
			previousSummary,
			nextSummary,
			yieldScheduler,
			sink,
		);
		const previousDestinations = previousSummary?.destinations;
		const nextDestinations = nextSummary?.destinations;
		let destinationChanged = false;

		let previousCount = 0;
		if (previousDestinations) {
			for (const [destinationPath, previousDestination] of previousDestinations) {
				const nextDestination = nextDestinations?.get(destinationPath);
				if (
					nextDestination &&
					areSourceDestinationsEqual(previousDestination, nextDestination)
				) {
					if (
						previousSummary &&
						nextSummary &&
						!areDestinationRepresentativeRefsEqual(
							previousSummary,
							nextSummary,
							destinationPath,
						)
					) {
						sink.markAffectedDestination(destinationPath);
						destinationChanged = true;
					}
				} else if (
					removeDestinationForSource(
						backlinksMap,
						sourcePath,
						destinationPath,
						undefined,
						sink,
					)
				) {
					sink.markAffectedDestination(destinationPath);
					destinationChanged = true;
				}

				previousCount++;
				const pendingYield = maybeYield(
					yieldScheduler,
					previousCount,
					HEAVY_YIELD_CHECK_INTERVAL,
				);
				if (pendingYield) {
					await pendingYield;
				}
			}
		}

		let nextCount = 0;
		if (nextDestinations) {
			for (const [destinationPath, nextDestination] of nextDestinations) {
				const previousDestination = previousDestinations?.get(destinationPath);
				if (
					!previousDestination ||
					!areSourceDestinationsEqual(previousDestination, nextDestination)
				) {
					if (
						addDestinationForSource(
							backlinksMap,
							sourcePath,
							destinationPath,
							nextDestination,
							undefined,
							sink,
						)
					) {
						sink.markAffectedDestination(destinationPath);
						destinationChanged = true;
					}
				}

				nextCount++;
				const pendingYield = maybeYield(
					yieldScheduler,
					nextCount,
					HEAVY_YIELD_CHECK_INTERVAL,
				);
				if (pendingYield) {
					await pendingYield;
				}
			}
		}

		const sourceSummaryChanged = destinationChanged || representativeChanged;
		return sourceSummaryChanged;
	}

	async function reconcileBacklinksBySourceCollectingAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval?: BacklinkRemovalMutationCallback,
		onAddition?: BacklinkAdditionMutationCallback,
	): Promise<BacklinkReconcileResult> {
		const affectedDestinations = new Set<string>();
		const representativeChangedLookupKeys = new Set<string>();
		const sink = createBacklinkReconcileResultSink(
			affectedDestinations,
			representativeChangedLookupKeys,
			onRemoval,
			onAddition,
		);
		const sourceSummaryChanged = await reconcileBacklinksBySourceIntoAsync(
			backlinksMap,
			sourcePath,
			previousSummary,
			nextSummary,
			yieldScheduler,
			sink,
		);

		return {
			changedDestinationPaths: affectedDestinations,
			changedRepresentativeLookupKeys: representativeChangedLookupKeys,
			sourceSummaryChanged,
		};
	}

	return {
		removeBacklinksBySourceIntoAsync,
		removeBacklinksBySourceAsync,
		buildSourceSummaryForFileAsync,
		reconcileBacklinksBySourceCollectingAsync,
		reconcileBacklinksBySourceIntoAsync,
	};
}

function createBacklinkReconcileResultSink(
	affectedDestinations: Set<string>,
	representativeChangedLookupKeys: Set<string>,
	onRemoval?: BacklinkRemovalMutationCallback,
	onAddition?: BacklinkAdditionMutationCallback,
): BacklinkReconcileSink {
	return {
		onBacklinkRemoved(
			lookupPath,
			lookupKey,
			sourcePath,
			hadResolved,
			isLookupPathEmptyAfter,
		) {
			onRemoval?.(
				lookupPath,
				lookupKey,
				sourcePath,
				hadResolved,
				isLookupPathEmptyAfter,
			);
		},
		onBacklinkAdded(
			lookupPath,
			lookupKey,
			sourcePath,
			isNewSource,
			hadResolved,
			hasResolved,
		) {
			onAddition?.(
				lookupPath,
				lookupKey,
				sourcePath,
				isNewSource,
				hadResolved,
				hasResolved,
			);
		},
		markAffectedDestination(destinationPath) {
			affectedDestinations.add(destinationPath);
		},
		markRepresentativeChangedLookupKey(lookupKey) {
			representativeChangedLookupKeys.add(lookupKey);
		},
	};
}
