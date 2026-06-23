import { type BacklinksBuildArtifacts } from "core/indexing/backlink-builder/backlinkBuildArtifacts";
import { buildDetailedBacklinksArtifactsChunked } from "core/indexing/backlink-builder/backlinkIndexer";
import {
	createLinkResolutionAmbiguityDetector,
	type MutableLinkResolutionAmbiguityDetector,
} from "../link-resolution/linkResolution";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { IndexSnapshot, RebuildOptions, TagIndex } from "../types/IndexTypes";

export interface BuiltIndexesResult {
	snapshot: IndexSnapshot;
	tagIndex: TagIndex;
}

/**
 * Builds the link index snapshot for the supplied vault.
 */
export async function buildIndexSnapshotAsync(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: RebuildOptions = {},
	includeTagIndex = true,
	ambiguityDetector: MutableLinkResolutionAmbiguityDetector = createLinkResolutionAmbiguityDetector(
		vault,
	),
): Promise<IndexSnapshot> {
	return (
		await buildIndexesAsync(
			vault,
			metadataCache,
			options,
			includeTagIndex,
			ambiguityDetector,
		)
	).snapshot;
}

/**
 * Builds the link index snapshot and its associated tag index.
 */
export async function buildIndexesAsync(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: RebuildOptions = {},
	includeTagIndex = true,
	ambiguityDetector: MutableLinkResolutionAmbiguityDetector = createLinkResolutionAmbiguityDetector(
		vault,
	),
): Promise<BuiltIndexesResult> {
	return createBuiltIndexesResult(
		await buildDetailedBacklinksArtifactsChunked(
			vault,
			metadataCache,
			options,
			includeTagIndex,
			ambiguityDetector,
		),
	);
}

function createBuiltIndexesResult(
	artifacts: BacklinksBuildArtifacts,
): BuiltIndexesResult {
	return {
		snapshot: createSnapshot(artifacts),
		tagIndex: artifacts.tagIndex,
	};
}

function createSnapshot(artifacts: BacklinksBuildArtifacts): IndexSnapshot {
	return {
		backlinksMap: artifacts.detailedMap,
		sourceSummaries: artifacts.sourceSummaries,
		linkLookupToSources: artifacts.linkLookupToSources,
		unresolvedLinkLookupToSources: artifacts.unresolvedLinkLookupToSources,
		lookupKeyToLookupPaths: artifacts.lookupKeyToLookupPaths,
		unresolvedLookupToSources: artifacts.unresolvedLookupToSources,
		lookupPathResolvedSourceCount: artifacts.lookupPathResolvedSourceCount,
		lookupKeyDirectResolvedPathCount: artifacts.lookupKeyDirectResolvedPathCount,
		lookupKeyToSources: artifacts.lookupKeyToSources,
	};
}
