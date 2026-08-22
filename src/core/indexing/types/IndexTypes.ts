import type { BacklinksMap, TagReference } from "types/domain";
import type { CompactStringSet } from "shared/collections/compactStringSet";

export type IncrementalFileChangeType = "create" | "modify" | "delete" | "rename";

export type IncrementalFileChange =
	| {
			type: "create";
			path: string;
	  }
	| {
			type: "modify";
			path: string;
	  }
	| {
			type: "delete";
			path: string;
	  }
	| {
			type: "rename";
			oldPath: string;
			newPath: string;
	  };

/**
 * Canonical indexes:
 * - sourceSummaries
 * - backlinksMap
 *
 * Derived lookup indexes:
 * - lookupKeyToLookupPaths
 * - lookupPathResolvedSourceCount
 *
 * Query caches:
 * - should not live here
 */

export interface TagIndexEntry {
	tags: readonly TagReference[];
}

export interface TagIndex {
	tagToFilePaths: Map<string, Set<string>>;
	fileEntries: Map<string, TagIndexEntry>;
}

export interface OrderedBacklinkRef {
	destinationPath: string;
	rawLookupKey: string;
	isUnresolved: boolean;
	rawText: string;
}

export interface SourceDestinationSummary {
	readonly count: number;
	readonly hasResolved: boolean;
	readonly firstRefIndex: number;
}

export interface SourceLookupSummary {
	readonly firstRefIndex: number;
	readonly rawLinkPaths: string | readonly string[];
	readonly isUnresolved: boolean;
}

export interface SourceSummary {
	readonly destinations: ReadonlyMap<string, Readonly<SourceDestinationSummary>>;
	/**
	 * Compact representative refs indexed by destinations.firstRefIndex and
	 * lookupEntries.firstRefIndex. This is not a full ordered occurrence list.
	 */
	readonly orderedReferences: readonly Readonly<OrderedBacklinkRef>[];
	/**
	 * The canonical source of lookup keys for this source.
	 * All lookup key enumeration, existence checks, and size queries
	 * must go through this map.
	 */
	readonly lookupEntries: ReadonlyMap<string, Readonly<SourceLookupSummary>>;
	readonly hasSourceDependentLinks: boolean;
}

export interface IndexSnapshot {
	backlinksMap: BacklinksMap;
	sourceSummaries: Map<string, SourceSummary>;
	linkLookupToSources: Map<string, Set<string>>;
	lookupKeyToLookupPaths: Map<string, CompactStringSet>;
	lookupPathResolvedSourceCount: Map<string, number>;
}

export interface IndexMutationResult {
	snapshot: IndexSnapshot;
	affectedPaths: Set<string>;
	affectedLookupPaths: Set<string>;
	affectedLookupKeys: Set<string>;
	affectedLinkSourcePaths: Set<string>;
	cacheInvalidationPaths: Iterable<string>;
	/**
	 * Link index (backlink / unresolved / lookup graph) に意味的差分があったか.
	 * 本文のみの変更では false になる.
	 */
	linkIndexChanged: boolean;
}

export interface TimeSlicingOptions {
	yieldFn?: () => Promise<void>;
	yieldIntervalMs?: number;
}

export interface RebuildOptions extends TimeSlicingOptions {
	signal?: AbortSignal;
}

export function createEmptyIndexSnapshot(): IndexSnapshot {
	return {
		backlinksMap: new Map(),
		sourceSummaries: new Map(),
		linkLookupToSources: new Map(),
		lookupKeyToLookupPaths: new Map(),
		lookupPathResolvedSourceCount: new Map(),
	};
}
