import type { BacklinksMap, TagReference } from "types/domain";

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
 * - lookupKeyToSources
 * - unresolvedLookupToSources
 * - lookupPathResolvedSourceCount
 * - lookupKeyDirectResolvedPathCount
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
	displayText?: string;
	key?: string;
}

export interface SourceDestinationSummary {
	count: number;
	hasResolved: boolean;
	firstRefIndex: number;
}

export interface SourceSummary {
	readonly destinations: ReadonlyMap<string, Readonly<SourceDestinationSummary>>;
	/**
	 * Compact representative refs indexed by destinations.firstRefIndex and
	 * firstRefIndexByLookupKey. This is not a full ordered occurrence list.
	 */
	readonly orderedReferences: readonly Readonly<OrderedBacklinkRef>[];
	/**
	 * The canonical source of lookup keys for this source.
	 * All lookup key enumeration, existence checks, and size queries
	 * must go through this map. There is no separate lookupKeys set.
	 */
	readonly firstRefIndexByLookupKey: ReadonlyMap<string, number>;
	readonly lookupKeyToRawLinkPaths: ReadonlyMap<string, string | readonly string[]>;
	readonly unresolvedLookupKeys: ReadonlySet<string>;
	readonly hasSourceDependentLinks: boolean;
}

export interface IndexSnapshot {
	backlinksMap: BacklinksMap;
	sourceSummaries: Map<string, SourceSummary>;
	linkLookupToSources: Map<string, Set<string>>;
	unresolvedLinkLookupToSources: Map<string, Set<string>>;
	lookupKeyToLookupPaths: Map<string, Set<string>>;
	unresolvedLookupToSources: Map<string, Set<string>>;
	lookupPathResolvedSourceCount: Map<string, number>;
	lookupKeyDirectResolvedPathCount: Map<string, number>;
	lookupKeyToSources: Map<string, Set<string>>;
}

export interface IndexMutationResult {
	snapshot: IndexSnapshot;
	affectedPaths: Set<string>;
	affectedLookupPaths: Set<string>;
	affectedLookupKeys: Set<string>;
	affectedLinkSourcePaths: Set<string>;
	cacheInvalidationPaths: Iterable<string>;
	/**
	 * @deprecated Use linkIndexChanged instead.
	 * Kept for temporary compatibility.
	 */
	changesApplied: boolean;
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
		unresolvedLinkLookupToSources: new Map(),
		lookupKeyToLookupPaths: new Map(),
		unresolvedLookupToSources: new Map(),
		lookupPathResolvedSourceCount: new Map(),
		lookupKeyDirectResolvedPathCount: new Map(),
		lookupKeyToSources: new Map(),
	};
}
