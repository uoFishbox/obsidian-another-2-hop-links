import { getLinkpath, normalizePath, type TFile } from "obsidian";
import {
	INDEXING_YIELD_INTERVAL_MS,
	isIndexLinkCapableExtension,
} from "indexing/config";
import type { CachedMetadataWithLinkReferences, LinkReference } from "indexing/model";
import { extractTags } from "../metadata/metadataExtractor";
import { toCaseInsensitiveLookupKey } from "../link-resolution/linkResolution";
import type { RebuildOptions } from "../indexState";
import {
	createEmptyLinkIndex,
	reconcileSourceRow,
	resolvedEdgeKey,
	type SourceEdge,
	unresolvedEdgeKey,
} from "../link-index/linkIndex";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import {
	addFileTagsToTagIndex,
	createEmptyTagIndex,
} from "../tag-index/tagIndexMutations";
import {
	createYieldScheduler,
	defaultYieldToMainThread,
	HEAVY_YIELD_CHECK_INTERVAL,
	maybeYield,
	YIELD_CHECK_INTERVAL,
	type YieldScheduler,
	type YieldStepGenerator,
} from "../timeSlicing";
import type { BacklinksBuildArtifacts } from "./backlinkBuildArtifacts";

export type ChunkedBacklinksBuildOptions = RebuildOptions;

const HAS_EXTENSION_RE = /\.[a-z0-9]+$/i;

interface ResolvedEdgeMemo {
	readonly global: Map<string, string>;
	readonly local: Map<string, string>;
}

interface LinkResolutionAmbiguityIndex {
	readonly fileNameCounts: Map<string, number>;
	readonly baseNameCounts: Map<string, number>;
}

/** Builds the canonical index directly from every file's parsed metadata. */
export async function buildLinkIndexArtifactsChunked(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: ChunkedBacklinksBuildOptions,
	includeTagIndex = true,
): Promise<BacklinksBuildArtifacts> {
	throwIfRebuildAborted(options.signal);
	const configuredYieldFn = options.yieldFn ?? defaultYieldToMainThread;
	const yieldScheduler = createYieldScheduler(async () => {
		throwIfRebuildAborted(options.signal);
		await configuredYieldFn();
		throwIfRebuildAborted(options.signal);
	}, options.yieldIntervalMs ?? INDEXING_YIELD_INTERVAL_MS);
	const linkIndex = createEmptyLinkIndex();
	const noOpSink = { markChangedEdge: (_key: string): void => {} };
	const tagIndex = createEmptyTagIndex();
	const allFiles = vault.getFiles();
	const ambiguityIndex = createLinkResolutionAmbiguityIndex(allFiles);
	const resolvedEdgeMemo: ResolvedEdgeMemo = {
		global: new Map(),
		local: new Map(),
	};
	let linkCapableFileCount = 0;
	let indexedSourceCount = 0;

	// esbuild replaces process.env.NODE_ENV at build time, so this branch is
	// dead-code eliminated in production builds.
	const shouldLog = process.env.NODE_ENV === "development";
	const buildStartedAt = shouldLog ? performance.now() : 0;
	if (shouldLog) {
		console.info("[BacklinkIndexer] Backlink map build start");
	}
	for (let index = 0; index < allFiles.length; index++) {
		const file = allFiles[index];
		const normalizedExtension = file.extension.toLowerCase();
		const cache = metadataCache.getFileCache(
			file,
		) as CachedMetadataWithLinkReferences | null;

		if (isIndexLinkCapableExtension(normalizedExtension)) {
			resolvedEdgeMemo.local.clear();
			const sourceRowSteps = readSourceRowFromMetadataChunked(
				metadataCache,
				file,
				cache,
				resolvedEdgeMemo,
				ambiguityIndex,
				yieldScheduler,
			);
			let sourceRowStep = sourceRowSteps.next();
			while (!sourceRowStep.done) {
				await sourceRowStep.value;
				sourceRowStep = sourceRowSteps.next();
			}
			const sourceRow = sourceRowStep.value;
			reconcileSourceRow(linkIndex, file.path, sourceRow, noOpSink);
			linkCapableFileCount++;
			if (sourceRow.length > 0) {
				indexedSourceCount++;
			}
		}

		if (includeTagIndex && normalizedExtension === "md") {
			addFileTagsToTagIndex(tagIndex, file.path, extractTags(cache));
		}

		const pendingYield = maybeYield(
			yieldScheduler,
			index + 1,
			YIELD_CHECK_INTERVAL,
		);
		if (pendingYield) await pendingYield;
	}
	if (shouldLog) {
		console.info("[BacklinkIndexer] Backlink map build end (ms):", {
			durationMs: roundTimingMs(performance.now() - buildStartedAt),
			vaultFileCount: allFiles.length,
			linkCapableFileCount,
			indexedSourceCount,
		});
	}

	throwIfRebuildAborted(options.signal);
	return { linkIndex, tagIndex };
}

function* readSourceRowFromMetadataChunked(
	metadataCache: IMetadataCache,
	sourceFile: TFile,
	cache: CachedMetadataWithLinkReferences | null,
	resolvedEdgeMemo: ResolvedEdgeMemo,
	ambiguityIndex: LinkResolutionAmbiguityIndex,
	yieldScheduler: YieldScheduler,
): YieldStepGenerator<readonly SourceEdge[]> {
	const countsByKey = new Map<string, number>();
	let referenceCount = 0;

	function* visitReferences(
		references: readonly LinkReference[] | undefined,
	): YieldStepGenerator {
		if (!references) return;

		for (const reference of references) {
			const rawLinkPath = getLinkpath(reference.link);
			let key =
				resolvedEdgeMemo.local.get(rawLinkPath) ??
				resolvedEdgeMemo.global.get(rawLinkPath);
			if (key === undefined) {
				const destination = metadataCache.getFirstLinkpathDest(
					rawLinkPath,
					sourceFile.path,
				);
				key = destination
					? resolvedEdgeKey(destination.path)
					: unresolvedEdgeKey(rawLinkPath);
				const memo = isAmbiguousRawLinkPath(rawLinkPath, ambiguityIndex)
					? resolvedEdgeMemo.local
					: resolvedEdgeMemo.global;
				memo.set(rawLinkPath, key);
			}
			countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);

			referenceCount++;
			const pendingYield = maybeYield(
				yieldScheduler,
				referenceCount,
				HEAVY_YIELD_CHECK_INTERVAL,
			);
			if (pendingYield) yield pendingYield;
		}
	}

	yield* visitReferences(cache?.links);
	yield* visitReferences(cache?.embeds);
	yield* visitReferences(cache?.frontmatterLinks);

	return Array.from(countsByKey, ([key, count]) => ({ key, count })).sort(
		compareSourceEdges,
	);
}

function createLinkResolutionAmbiguityIndex(
	files: readonly TFile[],
): LinkResolutionAmbiguityIndex {
	const fileNameCounts = new Map<string, number>();
	const baseNameCounts = new Map<string, number>();

	for (const file of files) {
		const fileName = getPathBasename(normalizePath(file.path));
		const baseName = getBaseNameFromFileName(fileName);
		incrementCount(fileNameCounts, toCaseInsensitiveLookupKey(fileName));
		incrementCount(baseNameCounts, toCaseInsensitiveLookupKey(baseName));
	}

	return { fileNameCounts, baseNameCounts };
}

function isAmbiguousRawLinkPath(
	rawLinkPath: string,
	index: LinkResolutionAmbiguityIndex,
): boolean {
	if (hasSourceDependentRawLinkPath(rawLinkPath)) {
		return true;
	}
	if (rawLinkPath.includes("/") || rawLinkPath.includes("\\")) {
		return false;
	}

	const fileName = getPathBasename(normalizePath(rawLinkPath));
	if (fileName.length === 0) {
		return true;
	}

	const lookupKey = toCaseInsensitiveLookupKey(fileName);
	if (HAS_EXTENSION_RE.test(fileName)) {
		const exactFileNameCount = index.fileNameCounts.get(lookupKey) ?? 0;
		const markdownBaseNameCount = index.baseNameCounts.get(lookupKey) ?? 0;
		return exactFileNameCount + markdownBaseNameCount > 1;
	}

	return (index.baseNameCounts.get(lookupKey) ?? 0) > 1;
}

function hasSourceDependentRawLinkPath(rawLinkPath: string): boolean {
	let segmentStart = 0;
	for (let index = 0; index <= rawLinkPath.length; index++) {
		const character =
			index < rawLinkPath.length ? rawLinkPath.charCodeAt(index) : -1;
		if (character !== 0x2f && character !== 0x5c && character !== -1) {
			continue;
		}

		const segmentLength = index - segmentStart;
		if (
			(segmentLength === 1 && rawLinkPath.charCodeAt(segmentStart) === 0x2e) ||
			(segmentLength === 2 &&
				rawLinkPath.charCodeAt(segmentStart) === 0x2e &&
				rawLinkPath.charCodeAt(segmentStart + 1) === 0x2e)
		) {
			return true;
		}

		segmentStart = index + 1;
	}
	return false;
}

function getPathBasename(path: string): string {
	const slashIndex = path.lastIndexOf("/");
	return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}

function getBaseNameFromFileName(fileName: string): string {
	const dotIndex = fileName.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
		return fileName;
	}
	return fileName.slice(0, dotIndex);
}

function incrementCount(counts: Map<string, number>, key: string): void {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

function compareSourceEdges(left: SourceEdge, right: SourceEdge): number {
	return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function throwIfRebuildAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new DOMException("Index rebuild was superseded", "AbortError");
	}
}

function roundTimingMs(durationMs: number): number {
	return Math.round(durationMs * 10) / 10;
}
