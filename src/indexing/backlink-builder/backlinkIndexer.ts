import { TFile } from "obsidian";

import {
	createLinkResolutionAmbiguityDetector,
	toCaseInsensitiveLookupKey,
	type LinkResolutionAmbiguityDetector,
	type ResolvedLinkInfo,
} from "../link-resolution/linkResolution";
import type {
	BacklinkSourceMap,
	CachedMetadataWithLinkReferences,
	LinkReference,
	IndexedLink,
} from "indexing/model";
import type { IVault, IMetadataCache } from "obsidian-integration/hostContracts";

import { extractTags, countLinkReferences } from "../metadata/metadataExtractor";
import {
	INDEXING_YIELD_INTERVAL_MS,
	isIndexLinkCapableExtension,
} from "indexing/config";
import type {
	RebuildOptions,
	SourceDestinationSummary,
	SourceSummary,
} from "../indexState";
import { addCompactStringSetValue } from "shared/collections/compactStringSet";
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
	createResolvedLinkMemo,
	visitResolvedBacklinkRefsUnorderedChunked,
	type ResolvedLinkMemo,
} from "./backlinkReferenceSequence";
import {
	createFileLocalAggregation,
	createSourceSummaryFromAggregationChunked,
	recordFileLocalReference,
	resetFileLocalAggregation,
	type FileLocalAggregation,
} from "./backlinkAggregation";
import type { BacklinksBuildArtifacts } from "./backlinkBuildArtifacts";

type MutableBacklinksBuildArtifacts = BacklinksBuildArtifacts;

export type ChunkedBacklinksBuildOptions = RebuildOptions;

export function dedupeBySourceFile(
	links: readonly Readonly<IndexedLink>[],
	excludePath?: string,
): IndexedLink[] {
	const sourcePathsSeen = new Set<string>();
	const uniqueLinks: IndexedLink[] = [];

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
		lookupKeyToLookupPaths: new Map(),
		lookupPathResolvedSourceCount: new Map(),
		tagIndex: createEmptyTagIndex(),
	};
}

function addSourceLookupIndexes(
	artifacts: MutableBacklinksBuildArtifacts,
	sourcePath: string,
	sourceSummary: SourceSummary,
): void {
	for (const lookupKey of sourceSummary.lookupEntries.keys()) {
		addCompactStringSetValue(artifacts.linkLookupToSources, lookupKey, sourcePath);
	}
}

function getOrCreateDestinationSourceMap(
	artifacts: MutableBacklinksBuildArtifacts,
	lookupPath: string,
): BacklinkSourceMap {
	const existing = artifacts.detailedMap.get(lookupPath);
	if (existing) {
		return existing;
	}

	const lookupKey = toCaseInsensitiveLookupKey(lookupPath);
	addCompactStringSetValue(artifacts.lookupKeyToLookupPaths, lookupKey, lookupPath);

	const sourceMap: BacklinkSourceMap = new Map();
	artifacts.detailedMap.set(lookupPath, sourceMap);
	return sourceMap;
}

function* indexFileIntoArtifacts(
	artifacts: MutableBacklinksBuildArtifacts,
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
		summary: SourceDestinationSummary,
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
	return {
		artifacts,
		steps: createBacklinksBuildSteps(
			artifacts,
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
		summary: SourceDestinationSummary,
	): void {
		const sourceMap = getOrCreateDestinationSourceMap(artifacts, destinationPath);
		sourceMap.set(currentSourcePath, summary);
		if (summary.hasResolved) {
			artifacts.lookupPathResolvedSourceCount.set(
				destinationPath,
				(artifacts.lookupPathResolvedSourceCount.get(destinationPath) ?? 0) + 1,
			);
		}
	}

	for (let i = 0; i < allFiles.length; i++) {
		const sourceFile = allFiles[i];
		currentSourcePath = sourceFile.path;
		const normalizedExtension = sourceFile.extension.toLowerCase();
		if (isIndexLinkCapableExtension(normalizedExtension)) {
			yield* indexFileIntoArtifacts(
				artifacts,
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
	throwIfRebuildAborted(options.signal);
	return execution.artifacts;
}

function throwIfRebuildAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException("Index rebuild was superseded", "AbortError");
	}
}
