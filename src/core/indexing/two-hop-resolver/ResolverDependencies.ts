import { extractTags } from "../metadata/metadataExtractor";
import {
	getLookupPathForLink,
	toCaseInsensitiveLookupKey,
} from "../link-resolution/linkResolution";
import type { TwoHopLinkResult } from "types/domain";
import type { IMetadataCache } from "types/obsidian";

export function collectResolverDependencies(
	metadataCache: IMetadataCache,
	result: TwoHopLinkResult,
): {
	dependencyPaths: Set<string>;
	dependencyLookupKeys: Set<string>;
	dependencyTags: Set<string>;
} {
	const dependencyPaths = new Set<string>();
	const dependencyLookupKeys = new Set<string>();
	const dependencyTags = new Set<string>();

	dependencyPaths.add(result.originFile.path);
	dependencyLookupKeys.add(
		toCaseInsensitiveLookupKey(result.originFile.path),
	);
	const originCache = metadataCache.getFileCache(result.originFile);
	for (const tag of extractTags(originCache)) {
		dependencyTags.add(tag.tag);
	}

	for (const branch of result.branches) {
		if (branch.hop1.path) {
			dependencyPaths.add(branch.hop1.path);
		}
		for (const hop2 of branch.hop2) {
			if (hop2.path) {
				dependencyPaths.add(hop2.path);
			}
		}
		const lookupPath = getLookupPathForLink(branch.hop1);
		dependencyLookupKeys.add(toCaseInsensitiveLookupKey(lookupPath));
	}

	for (const backlink of result.backlinks) {
		dependencyPaths.add(backlink.sourceFile.path);
	}

	for (const taggedNote of result.taggedNotes) {
		dependencyPaths.add(taggedNote.path);
	}

	return { dependencyPaths, dependencyLookupKeys, dependencyTags };
}
