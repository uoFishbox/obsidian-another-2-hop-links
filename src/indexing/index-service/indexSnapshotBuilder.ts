import { type BacklinksBuildArtifacts } from "indexing/backlink-builder/backlinkBuildArtifacts";
import { buildLinkIndexArtifactsChunked } from "indexing/backlink-builder/backlinkIndexer";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";
import type { MutableIndexState, RebuildOptions, TagIndex } from "../indexState";

export interface BuiltIndexesResult {
	snapshot: MutableIndexState;
	tagIndex: TagIndex;
}

export async function buildIndexesAsync(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: RebuildOptions = {},
	includeTagIndex = true,
): Promise<BuiltIndexesResult> {
	return createBuiltIndexesResult(
		await buildLinkIndexArtifactsChunked(
			vault,
			metadataCache,
			options,
			includeTagIndex,
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

function createSnapshot(artifacts: BacklinksBuildArtifacts): MutableIndexState {
	return artifacts.linkIndex;
}
