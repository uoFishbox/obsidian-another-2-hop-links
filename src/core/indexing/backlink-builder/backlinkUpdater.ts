import type { IVault, IMetadataCache } from "types/obsidian";
import { TFile } from "obsidian";
import { hasResolvedBacklink } from "./backlinkBuckets";
import type {
	BacklinkBucket,
	BacklinksMap,
	CachedMetadataWithLinkReferences,
} from "types/domain";
import {
	createLinkResolutionAmbiguityDetector,
	type LinkResolutionAmbiguityDetector,
	toCaseInsensitiveLookupKey,
} from "../link-resolution/linkResolution";
import type {
	OrderedBacklinkRef,
	SourceDestinationSummary,
	SourceSummary,
} from "../types/IndexTypes";
import {
	createResolvedLinkMemo,
	visitResolvedBacklinkRefsUnorderedAsync,
	type ResolvedLinkMemo,
} from "./backlinkReferenceSequence";
import {
	HEAVY_YIELD_CHECK_INTERVAL,
	maybeYield,
	type YieldScheduler,
} from "../timeSlicing";
import {
	createFileLocalAggregation,
	createSourceSummaryFromAggregation,
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

export interface BacklinkReconcileResult {
	affectedDestinations: Set<string>;
	representativeChangedLookupKeys: Set<string>;
	sourceSummaryChanged: boolean;
}

/**
 * Receives reconcile effects without allocating per-source result Sets.
 */
export interface BacklinkReconcileSink {
	markAffectedDestination(destinationPath: string): void;
	markRepresentativeChangedLookupKey(lookupKey: string): void;
}

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
	const firstRefIndex = summary.firstRefIndexByLookupKey.get(lookupKey);
	if (firstRefIndex === undefined) {
		return undefined;
	}
	return summary.orderedReferences[firstRefIndex];
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
	sink: BacklinkReconcileSink,
): Promise<boolean> {
	if (!previousSummary || !nextSummary) {
		return false;
	}

	let changed = false;
	let lookupKeyCount = 0;
	for (const lookupKey of previousSummary.firstRefIndexByLookupKey.keys()) {
		if (!nextSummary.firstRefIndexByLookupKey.has(lookupKey)) {
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

	reconcileBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval?: BacklinkRemovalMutationCallback,
		onAddition?: BacklinkAdditionMutationCallback,
	): Promise<BacklinkReconcileResult>;
	reconcileBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval: BacklinkRemovalMutationCallback | undefined,
		onAddition: BacklinkAdditionMutationCallback | undefined,
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
		onMutation?.(
			destinationPath,
			toCaseInsensitiveLookupKey(destinationPath),
			sourcePath,
			hasResolvedBacklink(removed),
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
	): boolean {
		let sourceMap = backlinksMap.get(destinationPath);
		if (!sourceMap) {
			sourceMap = new Map();
			backlinksMap.set(destinationPath, sourceMap);
		}
		const before = sourceMap.get(sourcePath);
		const hadResolved = before ? hasResolvedBacklink(before) : false;
		let after: BacklinkBucket;
		if (before) {
			before.count += destinationSummary.count;
			before.hasResolved ||= destinationSummary.hasResolved;
			after = before;
		} else {
			after = {
				count: destinationSummary.count,
				hasResolved: destinationSummary.hasResolved,
			};
			sourceMap.set(sourcePath, after);
		}
		onMutation?.(
			destinationPath,
			toCaseInsensitiveLookupKey(destinationPath),
			sourcePath,
			!before,
			hadResolved,
			hasResolvedBacklink(after),
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

		const chunked = createSourceSummaryFromAggregationChunked(
			localScratch,
			yieldScheduler,
		);
		let step = chunked.next();
		while (!step.done) {
			await step.value;
			step = chunked.next();
		}
		return step.value;
	}

	async function reconcileBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval?: BacklinkRemovalMutationCallback,
		onAddition?: BacklinkAdditionMutationCallback,
	): Promise<BacklinkReconcileResult>;
	async function reconcileBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval: BacklinkRemovalMutationCallback | undefined,
		onAddition: BacklinkAdditionMutationCallback | undefined,
		sink: BacklinkReconcileSink,
	): Promise<boolean>;
	async function reconcileBacklinksBySourceAsync(
		backlinksMap: BacklinksMap,
		sourcePath: string,
		previousSummary: SourceSummary | undefined,
		nextSummary: SourceSummary | undefined,
		yieldScheduler: YieldScheduler,
		onRemoval?: BacklinkRemovalMutationCallback,
		onAddition?: BacklinkAdditionMutationCallback,
		externalSink?: BacklinkReconcileSink,
	): Promise<BacklinkReconcileResult | boolean> {
		const affectedDestinations = externalSink ? undefined : new Set<string>();
		const representativeChangedLookupKeys = externalSink
			? undefined
			: new Set<string>();
		const sink =
			externalSink ??
			createBacklinkReconcileResultSink(
				affectedDestinations!,
				representativeChangedLookupKeys!,
			);
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
						onRemoval,
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
							onAddition,
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

		if (externalSink) {
			return sourceSummaryChanged;
		}

		return {
			affectedDestinations: affectedDestinations!,
			representativeChangedLookupKeys: representativeChangedLookupKeys!,
			sourceSummaryChanged,
		};
	}

	return {
		removeBacklinksBySourceAsync,
		buildSourceSummaryForFileAsync,
		reconcileBacklinksBySourceAsync,
	};
}

function createBacklinkReconcileResultSink(
	affectedDestinations: Set<string>,
	representativeChangedLookupKeys: Set<string>,
): BacklinkReconcileSink {
	return {
		markAffectedDestination(destinationPath) {
			affectedDestinations.add(destinationPath);
		},
		markRepresentativeChangedLookupKey(lookupKey) {
			representativeChangedLookupKeys.add(lookupKey);
		},
	};
}
