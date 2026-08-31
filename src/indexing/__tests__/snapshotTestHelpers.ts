import { buildIndexesAsync } from "../index-service/indexSnapshotBuilder";
import type { MutableIndexState, RebuildOptions, TagIndex } from "../indexState";
import type { IMetadataCache, IVault } from "obsidian-integration/hostContracts";

export async function buildIndexSnapshotAsync(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: RebuildOptions = {},
): Promise<MutableIndexState> {
	return (await buildIndexesAsync(vault, metadataCache, options)).snapshot;
}

export function serializeSnapshot(snapshot: MutableIndexState): unknown {
	return {
		incoming: Array.from(
			snapshot.incoming,
			([key, sources]) =>
				[key, Array.from(sources.entries()).sort(compareEntries)] as const,
		).sort(compareEntries),
		outgoing: Array.from(snapshot.outgoing.entries()).sort(compareEntries),
	};
}

export function serializeTagIndex(tagIndex: TagIndex): unknown {
	return {
		tagToFilePaths: Array.from(
			tagIndex.tagToFilePaths,
			([tag, paths]) =>
				[
					tag,
					typeof paths === "string" ? [paths] : Array.from(paths).sort(),
				] as const,
		).sort(compareEntries),
		fileEntries: Array.from(tagIndex.fileEntries.entries()).sort(compareEntries),
	};
}

function compareEntries(
	left: readonly [string, unknown],
	right: readonly [string, unknown],
): number {
	return left[0].localeCompare(right[0]);
}
