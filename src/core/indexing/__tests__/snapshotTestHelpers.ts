import { buildIndexesAsync } from "../index-service/indexSnapshotBuilder";
import type { BacklinkSourceMap } from "types/domain";
import type { IMetadataCache, IVault } from "types/obsidian";
import type { IndexSnapshot, RebuildOptions, TagIndex } from "../types/IndexTypes";

export async function buildIndexSnapshotAsync(
	vault: IVault,
	metadataCache: IMetadataCache,
	options: RebuildOptions = {},
): Promise<IndexSnapshot> {
	return (await buildIndexesAsync(vault, metadataCache, options)).snapshot;
}

export function serializeSnapshot(snapshot: IndexSnapshot) {
	return {
		backlinksMap: serializeNestedBacklinkMap(snapshot.backlinksMap),
		sourceSummaries: serializeSourceSummaryMap(snapshot.sourceSummaries),
		linkLookupToSources: serializeSetMap(snapshot.linkLookupToSources),
		lookupKeyToLookupPaths: serializeCompactSetMap(snapshot.lookupKeyToLookupPaths),
		lookupPathResolvedSourceCount: serializeNumberMap(
			snapshot.lookupPathResolvedSourceCount,
		),
	};
}

function serializeSourceSummaryMap(map: IndexSnapshot["sourceSummaries"]) {
	return Array.from(map.entries())
		.map(
			([sourcePath, summary]) =>
				[
					sourcePath,
					{
						destinations: Array.from(summary.destinations.entries())
							.map(
								([destinationPath, destination]) =>
									[
										destinationPath,
										{
											count: destination.count,
											hasResolved: destination.hasResolved,
											firstRefIndex: destination.firstRefIndex,
										},
									] as const,
							)
							.sort(([left], [right]) => left.localeCompare(right)),
						orderedReferences: summary.orderedReferences.map((ref) => ({
							destinationPath: ref.destinationPath,
							rawLookupKey: ref.rawLookupKey,
							isUnresolved: ref.isUnresolved,
							rawText: ref.rawText,
						})),
						firstRefIndexByLookupKey: Array.from(
							summary.lookupEntries.entries(),
							([lookupKey, entry]) =>
								[lookupKey, entry.firstRefIndex] as const,
						).sort(([left], [right]) => left.localeCompare(right)),
						lookupKeys: Array.from(summary.lookupEntries.keys()).sort(),
						lookupKeyToRawLinkPaths: Array.from(
							summary.lookupEntries.entries(),
						)
							.map(
								([lookupKey, entry]) =>
									[
										lookupKey,
										(typeof entry.rawLinkPaths === "string"
											? [entry.rawLinkPaths]
											: entry.rawLinkPaths.slice()
										).sort(),
									] as const,
							)
							.sort(([left], [right]) => left.localeCompare(right)),
						unresolvedLookupKeys: Array.from(
							summary.lookupEntries.entries(),
						)
							.filter(([, entry]) => entry.isUnresolved)
							.map(([lookupKey]) => lookupKey)
							.sort(),
						hasSourceDependentLinks: summary.hasSourceDependentLinks,
					},
				] as const,
		)
		.sort(([left], [right]) => left.localeCompare(right));
}

function serializeSetMap(map: Map<string, Iterable<string>>) {
	return Array.from(map.entries())
		.map(([key, values]) => [key, Array.from(values).sort()] as const)
		.sort(([left], [right]) => left.localeCompare(right));
}

function serializeCompactSetMap(map: IndexSnapshot["lookupKeyToLookupPaths"]) {
	return Array.from(map.entries())
		.map(
			([key, values]) =>
				[
					key,
					(typeof values === "string" ? [values] : Array.from(values)).sort(),
				] as const,
		)
		.sort(([left], [right]) => left.localeCompare(right));
}

function serializeNumberMap(map: Map<string, number>) {
	return Array.from(map.entries()).sort(([left], [right]) =>
		left.localeCompare(right),
	);
}

export function serializeTagIndex(tagIndex: TagIndex) {
	return {
		tagToFilePaths: serializeSetMap(tagIndex.tagToFilePaths),
		fileEntries: Array.from(tagIndex.fileEntries.entries())
			.map(
				([path, entry]) =>
					[path, entry.tags.map((tag) => tag.tag).sort()] as const,
			)
			.sort(([left], [right]) => left.localeCompare(right)),
	};
}

function serializeNestedBacklinkMap(map: Map<string, BacklinkSourceMap>) {
	return Array.from(map.entries())
		.map(
			([lookupPath, sourceMap]) =>
				[
					lookupPath,
					Array.from(sourceMap.entries())
						.map(([sourcePath, bucket]) => {
							return [
								sourcePath,
								{
									count: bucket.count,
									hasResolved: bucket.hasResolved,
								},
							] as const;
						})
						.sort(([left], [right]) => left.localeCompare(right)),
				] as const,
		)
		.sort(([left], [right]) => left.localeCompare(right));
}
