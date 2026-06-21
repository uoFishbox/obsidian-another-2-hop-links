import {
	getBacklinkCollectionCount,
	hasResolvedBacklink,
} from "../backlink-builder/backlinkBuckets";
import type { BacklinkSourceMap } from "types/domain";
import type { IndexSnapshot, TagIndex } from "../types/IndexTypes";

export function serializeSnapshot(snapshot: IndexSnapshot) {
	return {
		backlinksMap: serializeNestedBacklinkMap(snapshot.backlinksMap),
		sourceSummaries: serializeSourceSummaryMap(snapshot.sourceSummaries),
		linkLookupToSources: serializeSetMap(snapshot.linkLookupToSources),
		unresolvedLinkLookupToSources: serializeSetMap(
			snapshot.unresolvedLinkLookupToSources,
		),
		lookupKeyToLookupPaths: serializeSetMap(
			snapshot.lookupKeyToLookupPaths,
		),
		unresolvedLookupToSources: serializeSetMap(
			snapshot.unresolvedLookupToSources,
		),
		lookupPathResolvedSourceCount: serializeNumberMap(
			snapshot.lookupPathResolvedSourceCount,
		),
		lookupKeyDirectResolvedPathCount: serializeNumberMap(
			snapshot.lookupKeyDirectResolvedPathCount,
		),
		lookupKeyToSources: serializeSetMap(snapshot.lookupKeyToSources),
	};
}

export function serializeSourceSummaryMap(
	map: IndexSnapshot["sourceSummaries"],
) {
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
											hasResolved:
												destination.hasResolved,
											firstRefIndex:
												destination.firstRefIndex,
										},
									] as const,
							)
							.sort(([left], [right]) =>
								left.localeCompare(right),
							),
						orderedReferences: summary.orderedReferences.map(
							(ref) => ({
								destinationPath: ref.destinationPath,
								rawLookupKey: ref.rawLookupKey,
								isUnresolved: ref.isUnresolved,
								rawText: ref.rawText,
								displayText: ref.displayText,
								key: ref.key,
							}),
						),
						firstRefIndexByLookupKey: Array.from(
							summary.firstRefIndexByLookupKey.entries(),
						).sort(([left], [right]) => left.localeCompare(right)),
						lookupKeys: Array.from(
							summary.firstRefIndexByLookupKey.keys(),
						).sort(),
						lookupKeyToRawLinkPaths: Array.from(
							summary.lookupKeyToRawLinkPaths.entries(),
						)
							.map(
								([lookupKey, rawLinkPaths]) =>
									[
										lookupKey,
										(typeof rawLinkPaths === "string"
											? [rawLinkPaths]
											: rawLinkPaths.slice()
										).sort(),
									] as const,
							)
							.sort(([left], [right]) =>
								left.localeCompare(right),
							),
						unresolvedLookupKeys: Array.from(
							summary.unresolvedLookupKeys,
						).sort(),
						hasSourceDependentLinks:
							summary.hasSourceDependentLinks,
					},
				] as const,
		)
		.sort(([left], [right]) => left.localeCompare(right));
}

export function serializeSetMap(map: Map<string, Iterable<string>>) {
	return Array.from(map.entries())
		.map(([key, values]) => [key, Array.from(values).sort()] as const)
		.sort(([left], [right]) => left.localeCompare(right));
}

export function serializeNumberMap(map: Map<string, number>) {
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
									count: getBacklinkCollectionCount(bucket),
									length: bucket.length,
									hasResolved: hasResolvedBacklink(bucket),
								},
							] as const;
						})
						.sort(([left], [right]) => left.localeCompare(right)),
				] as const,
		)
		.sort(([left], [right]) => left.localeCompare(right));
}
