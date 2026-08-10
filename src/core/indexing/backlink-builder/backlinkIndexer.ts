import { TFile } from "obsidian";

import {
	createLinkResolutionAmbiguityDetector,
	toCaseInsensitiveLookupKey,
	type LinkResolutionAmbiguityDetector,
	type ResolvedLinkInfo,
} from "../link-resolution/linkResolution";
import type {
	CachedMetadataWithLinkReferences,
	LinkReference,
	TwoHopIndexedLink,
} from "types/domain";
import type { IVault, IMetadataCache } from "types/obsidian";

import { extractTags, countLinkReferences } from "../metadata/metadataExtractor";
import {
	INDEXING_YIELD_INTERVAL_MS,
	INDEX_LINK_CAPABLE_EXTENSIONS,
} from "../../../appConstants";
import type { RebuildOptions, SourceSummary } from "../types/IndexTypes";
import {
	addFileTagsToTagIndex,
	createEmptyTagIndex,
} from "../tag-index/tagIndexMutations";
import {
	createYieldScheduler,
	drainYieldSteps,
	defaultYieldToMainThread,
	HEAVY_YIELD_CHECK_INTERVAL,
	YIELD_CHECK_INTERVAL,
	type YieldScheduler,
	type YieldStepGenerator,
} from "../timeSlicing";
import {
	finalizePhaseTwoArtifactsChunked,
	type DestinationBuildState,
} from "./backlinkBuildPhaseTwo";
import {
	createResolvedLinkMemo,
	visitResolvedBacklinkRefsUnorderedChunked,
	type ResolvedLinkMemo,
} from "./backlinkReferenceSequence";
import {
	createBacklinkBucketForSource,
	createFileLocalAggregation,
	createSourceSummaryFromAggregationChunked,
	recordFileLocalReference,
	resetFileLocalAggregation,
	type FileLocalAggregation,
	type FileLocalDestinationAggregate,
} from "./backlinkAggregation";
import type { BacklinksBuildArtifacts } from "./backlinkBuildArtifacts";

type MutableBacklinksBuildArtifacts = BacklinksBuildArtifacts;

export type ChunkedBacklinksBuildOptions = RebuildOptions;

export function dedupeBySourceFile(
	links: readonly Readonly<TwoHopIndexedLink>[],
	excludePath?: string,
): TwoHopIndexedLink[] {
	const sourcePathsSeen = new Set<string>();
	const uniqueLinks: TwoHopIndexedLink[] = [];

	for (const link of links) {
		if (
			(!excludePath || link.sourceFile.path !== excludePath) &&
			!sourcePathsSeen.has(link.sourceFile.path)
		) {
			uniqueLinks.push(link);
			sourcePathsSeen.add(link.sourceFile.path);
		}
	}

	return uniqueLinks;
}

function createArtifactsAccumulator(): MutableBacklinksBuildArtifacts {
	return {
		detailedMap: new Map(),
		sourceSummaries: new Map(),
		linkLookupToSources: new Map(),
		unresolvedLinkLookupToSources: new Map(),
		lookupKeyToLookupPaths: new Map(),
		lookupPathResolvedSourceCount: new Map(),
		lookupKeyDirectResolvedPathCount: new Map(),
		lookupKeyToSources: new Map(),
		tagIndex: createEmptyTagIndex(),
	};
}

function addSourceLookupIndexes(
	artifacts: MutableBacklinksBuildArtifacts,
	sourcePath: string,
	sourceSummary: SourceSummary,
): void {
	for (const lookupKey of sourceSummary.firstRefIndexByLookupKey.keys()) {
		let sources = artifacts.linkLookupToSources.get(lookupKey);
		if (!sources) {
			sources = new Set<string>();
			artifacts.linkLookupToSources.set(lookupKey, sources);
		}
		sources.add(sourcePath);
	}

	for (const lookupKey of sourceSummary.unresolvedLookupKeys) {
		let sources = artifacts.unresolvedLinkLookupToSources.get(lookupKey);
		if (!sources) {
			sources = new Set<string>();
			artifacts.unresolvedLinkLookupToSources.set(lookupKey, sources);
		}
		sources.add(sourcePath);
	}
}

function getOrCreateDestinationBuildState(
	artifacts: MutableBacklinksBuildArtifacts,
	destinationBuildStates: Map<string, DestinationBuildState>,
	lookupPath: string,
): DestinationBuildState {
	const existing = destinationBuildStates.get(lookupPath);
	if (existing) {
		return existing;
	}

	const lookupKey = toCaseInsensitiveLookupKey(lookupPath);
	addLookupKeyPath(artifacts.lookupKeyToLookupPaths, lookupKey, lookupPath);
	let lookupSources = artifacts.lookupKeyToSources.get(lookupKey);
	if (!lookupSources) {
		lookupSources = new Set<string>();
		artifacts.lookupKeyToSources.set(lookupKey, lookupSources);
	}

	const state: DestinationBuildState = {
		sourceMap: new Map(),
		lookupKey,
		lookupSources,
		resolvedSourceCount: 0,
	};
	destinationBuildStates.set(lookupPath, state);
	artifacts.detailedMap.set(lookupPath, state.sourceMap);
	return state;
}

function addLookupKeyPath(
	lookupKeyToLookupPaths: Map<string, Set<string>>,
	lookupKey: string,
	lookupPath: string,
): void {
	let lookupPaths = lookupKeyToLookupPaths.get(lookupKey);
	if (!lookupPaths) {
		lookupPaths = new Set<string>();
		lookupKeyToLookupPaths.set(lookupKey, lookupPaths);
	}
	lookupPaths.add(lookupPath);
}

function* indexFileIntoArtifactsPhaseOne(
	artifacts: MutableBacklinksBuildArtifacts,
	destinationBuildStates: Map<string, DestinationBuildState>,
	metadataCache: IMetadataCache,
	sourceFile: TFile,
	normalizedExtension: string,
	includeTagIndex: boolean,
	resolvedMemo: ResolvedLinkMemo,
	localScratch: FileLocalAggregation,
	ambiguityDetector: LinkResolutionAmbiguityDetector,
	yieldScheduler: YieldScheduler,
	recordReference: (
		linkReference: LinkReference,
		resolved: ResolvedLinkInfo,
		offset: number,
		rawLinkPath: string,
	) => void,
	visitDestination: (
		destinationPath: string,
		aggregate: FileLocalDestinationAggregate,
	) => void,
): YieldStepGenerator {
	const sourcePath = sourceFile.path;
	const cache = metadataCache.getFileCache(
		sourceFile,
	) as CachedMetadataWithLinkReferences | null;
	const referenceCount = countLinkReferences(cache);
	if (referenceCount === 0) {
		if (includeTagIndex && normalizedExtension === "md") {
			const tags = extractTags(cache);
			addFileTagsToTagIndex(artifacts.tagIndex, sourcePath, tags);
		}
		return;
	}

	resetFileLocalAggregation(localScratch);

	yield* visitResolvedBacklinkRefsUnorderedChunked(
		metadataCache,
		sourceFile,
		cache,
		ambiguityDetector,
		resolvedMemo,
		yieldScheduler,
		recordReference,
		HEAVY_YIELD_CHECK_INTERVAL,
	);

	if (includeTagIndex && normalizedExtension === "md") {
		const tags = extractTags(cache);
		addFileTagsToTagIndex(artifacts.tagIndex, sourcePath, tags);
	}

	const sourceSummary = yield* createSourceSummaryFromAggregationChunked(
		localScratch,
		yieldScheduler,
		visitDestination,
	);
	if (sourceSummary) {
		artifacts.sourceSummaries.set(sourcePath, sourceSummary);
		addSourceLookupIndexes(artifacts, sourcePath, sourceSummary);
	}
}

interface BacklinksBuildExecution {
	artifacts: MutableBacklinksBuildArtifacts;
	destinationBuildStates: Map<string, DestinationBuildState>;
	steps: YieldStepGenerator;
}

function createBacklinksBuildExecution(
	vault: IVault,
	metadataCache: IMetadataCache,
	allFiles: TFile[],
	includeTagIndex: boolean,
	ambiguityDetector: LinkResolutionAmbiguityDetector | undefined,
	yieldScheduler: YieldScheduler,
): BacklinksBuildExecution {
	const artifacts = createArtifactsAccumulator();
	const destinationBuildStates = new Map<string, DestinationBuildState>();
	return {
		artifacts,
		destinationBuildStates,
		steps: createBacklinksBuildSteps(
			artifacts,
			destinationBuildStates,
			vault,
			metadataCache,
			allFiles,
			includeTagIndex,
			ambiguityDetector,
			yieldScheduler,
		),
	};
}

function* createBacklinksBuildSteps(
	artifacts: MutableBacklinksBuildArtifacts,
	destinationBuildStates: Map<string, DestinationBuildState>,
	vault: IVault,
	metadataCache: IMetadataCache,
	allFiles: TFile[],
	includeTagIndex: boolean,
	ambiguityDetector: LinkResolutionAmbiguityDetector | undefined,
	yieldScheduler: YieldScheduler,
): YieldStepGenerator {
	const resolvedMemo = createResolvedLinkMemo();
	const localScratch = createFileLocalAggregation();
	const detector = ambiguityDetector ?? createLinkResolutionAmbiguityDetector(vault);
	let currentSourcePath = "";

	function recordIntoScratch(
		linkReference: LinkReference,
		resolved: ResolvedLinkInfo,
		offset: number,
		rawLinkPath: string,
	): void {
		recordFileLocalReference(
			localScratch,
			linkReference,
			resolved,
			offset,
			rawLinkPath,
		);
	}

	function visitDestinationForCurrentSource(
		destinationPath: string,
		aggregate: FileLocalDestinationAggregate,
	): void {
		const destinationState = getOrCreateDestinationBuildState(
			artifacts,
			destinationBuildStates,
			destinationPath,
		);
		destinationState.sourceMap.set(
			currentSourcePath,
			createBacklinkBucketForSource(aggregate),
		);
		destinationState.lookupSources.add(currentSourcePath);
		if (aggregate.hasResolved) {
			destinationState.resolvedSourceCount++;
		}
	}

	for (let i = 0; i < allFiles.length; i++) {
		const sourceFile = allFiles[i];
		currentSourcePath = sourceFile.path;
		const normalizedExtension = sourceFile.extension.toLowerCase();
		if (INDEX_LINK_CAPABLE_EXTENSIONS.has(normalizedExtension)) {
			yield* indexFileIntoArtifactsPhaseOne(
				artifacts,
				destinationBuildStates,
				metadataCache,
				sourceFile,
				normalizedExtension,
				includeTagIndex,
				resolvedMemo,
				localScratch,
				detector,
				yieldScheduler,
				recordIntoScratch,
				visitDestinationForCurrentSource,
			);
		}
		const pendingYield = yieldScheduler.checkpoint(i + 1, YIELD_CHECK_INTERVAL);
		if (pendingYield) {
			yield pendingYield;
		}
	}
}

export async function buildDetailedBacklinksArtifactsChunked(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: ChunkedBacklinksBuildOptions,
	includeTagIndex = true,
	ambiguityDetector?: LinkResolutionAmbiguityDetector,
): Promise<BacklinksBuildArtifacts> {
	throwIfRebuildAborted(options.signal);
	const allFiles = vault.getFiles();
	const configuredYieldFn = options.yieldFn ?? defaultYieldToMainThread;
	const yieldFn = async (): Promise<void> => {
		throwIfRebuildAborted(options.signal);
		await configuredYieldFn();
		throwIfRebuildAborted(options.signal);
	};
	const yieldIntervalMs = options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS;
	const yieldScheduler = createYieldScheduler(yieldFn, yieldIntervalMs);
	const execution = createBacklinksBuildExecution(
		vault,
		metadataCache,
		allFiles,
		includeTagIndex,
		ambiguityDetector,
		yieldScheduler,
	);
	await drainYieldSteps(execution.steps);
	await finalizePhaseTwoArtifactsChunked(
		execution.artifacts,
		execution.destinationBuildStates,
		yieldScheduler,
	);
	throwIfRebuildAborted(options.signal);
	return execution.artifacts;
}

function throwIfRebuildAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException("Index rebuild was superseded", "AbortError");
	}
}
