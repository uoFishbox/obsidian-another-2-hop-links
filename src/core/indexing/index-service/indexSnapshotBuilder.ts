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
		lookupKeyToLookupPaths: artifacts.lookupKeyToLookupPaths,
		lookupPathResolvedSourceCount: artifacts.lookupPathResolvedSourceCount,
		lookupKeyDirectResolvedPathCount: artifacts.lookupKeyDirectResolvedPathCount,
		lookupKeyToSources: artifacts.lookupKeyToSources,
	};
}
