import type { BacklinkSourceMap, BacklinksMap, TagReference } from "indexing/model";
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

export interface TagIndex {
	tagToFilePaths: Map<string, CompactStringSet>;
	fileEntries: Map<string, readonly TagReference[]>;
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

/**
 * Read-only view of the indexes used by query and planning code.
 *
 * The maps are mutated by the incremental writer, so this type is deliberately
 * separate from {@link MutableIndexState}.  Keeping the distinction in the
 * type system makes ownership explicit without changing the runtime shape.
 */
export interface ReadonlyIndexState {
	readonly backlinksMap: ReadonlyMap<string, BacklinkSourceMap>;
	readonly sourceSummaries: ReadonlyMap<string, SourceSummary>;
	readonly linkLookupToSources: ReadonlyMap<string, CompactStringSet>;
	readonly lookupKeyToLookupPaths: ReadonlyMap<string, CompactStringSet>;
	readonly lookupPathResolvedSourceCount: ReadonlyMap<string, number>;
}

/** Mutable index state owned by the indexing writer. */
export interface MutableIndexState {
	backlinksMap: BacklinksMap;
	sourceSummaries: Map<string, SourceSummary>;
	linkLookupToSources: Map<string, CompactStringSet>;
	lookupKeyToLookupPaths: Map<string, CompactStringSet>;
	lookupPathResolvedSourceCount: Map<string, number>;
}

export interface IndexMutationResult {
	snapshot: MutableIndexState;
	changedFilePaths: Set<string>;
	changedDestinationPaths: Set<string>;
	changedLookupKeys: Set<string>;
	changedLinkSourcePaths: Set<string>;
	cacheInvalidationPaths: Iterable<string>;
	/**
	 * Whether the link index (backlinks, unresolved links, or lookup graph) changed semantically.
	 * False for body-only changes.
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

export function createEmptyMutableIndexState(): MutableIndexState {
	return {
		backlinksMap: new Map(),
		sourceSummaries: new Map(),
		linkLookupToSources: new Map(),
		lookupKeyToLookupPaths: new Map(),
		lookupPathResolvedSourceCount: new Map(),
	};
}
