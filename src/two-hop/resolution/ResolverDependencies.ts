import type { CachedMetadata } from "obsidian";
import { extractTags } from "indexing/metadata/metadataExtractor";
import {
	getLookupPathForLink,
	toCaseInsensitiveLookupKey,
} from "indexing/link-resolution/linkResolution";
import type { TwoHopLinkResult } from "two-hop/model";

/** Inputs whose current index state must remain valid for a two-hop result. */
export interface TwoHopResolverDependencies {
	readonly originPath: string;
	readonly relevantPaths: ReadonlySet<string>;
	readonly relevantLookupKeys: ReadonlySet<string>;
	readonly relevantTags: ReadonlySet<string>;
	readonly structuralSourcePaths: ReadonlySet<string>;
}

/** A resolver result and the dependency generation against which it was built. */
export interface TwoHopResolveSnapshot {
	readonly result: TwoHopLinkResult;
	readonly dependencies: TwoHopResolverDependencies;
}

/**
 * Builds the shared dependency model used by resolver cache invalidation and UI reloads.
 */
export function collectResolverDependencies(
	originMetadata: CachedMetadata | null,
	result: TwoHopLinkResult,
): TwoHopResolverDependencies {
	const relevantPaths = new Set<string>();
	const relevantLookupKeys = new Set<string>();
	const relevantTags = new Set<string>();
	const structuralSourcePaths = new Set<string>();

	relevantPaths.add(result.originFile.path);
	relevantLookupKeys.add(toCaseInsensitiveLookupKey(result.originFile.path));
	structuralSourcePaths.add(result.originFile.path);
	for (const tag of extractTags(originMetadata)) {
		relevantTags.add(tag.tag);
	}

	for (const branch of result.branches) {
		if (branch.hop1.path) {
			relevantPaths.add(branch.hop1.path);
			structuralSourcePaths.add(branch.hop1.path);
		}
		for (const hop2 of branch.hop2) {
			relevantPaths.add(hop2.sourceFile.path);
		}
		const lookupPath = getLookupPathForLink(branch.hop1);
		relevantLookupKeys.add(toCaseInsensitiveLookupKey(lookupPath));
	}

	for (const backlink of result.backlinks) {
		relevantPaths.add(backlink.sourceFile.path);
		structuralSourcePaths.add(backlink.sourceFile.path);
	}

	for (const taggedNote of result.taggedNotes) {
		relevantPaths.add(taggedNote.path);
		structuralSourcePaths.add(taggedNote.path);
	}

	return Object.freeze({
		originPath: result.originFile.path,
		relevantPaths,
		relevantLookupKeys,
		relevantTags,
		structuralSourcePaths,
	});
}

/** Creates one immutable generation boundary for result publication. */
export function createTwoHopResolveSnapshot(
	result: TwoHopLinkResult,
	dependencies: TwoHopResolverDependencies,
): TwoHopResolveSnapshot {
	return Object.freeze({ result, dependencies });
}

export function createResolveAbortError(): DOMException | Error {
	if (typeof DOMException !== "undefined") {
		return new DOMException("Two-hop resolve aborted", "AbortError");
	}

	const error = new Error("Two-hop resolve aborted");
	error.name = "AbortError";
	return error;
}

export function throwIfResolveAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw createResolveAbortError();
	}
}
