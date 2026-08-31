import type { TagReference } from "indexing/model";
import {
	createEmptyLinkIndex,
	type EdgeKey,
	type LinkIndex,
	type ReadonlyLinkIndex,
} from "./link-index/linkIndex";
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

export interface TagIndex {
	tagToFilePaths: Map<string, CompactStringSet>;
	fileEntries: Map<string, readonly TagReference[]>;
}

/** Read-only view of the canonical two-direction link index. */
export type ReadonlyIndexState = ReadonlyLinkIndex;

/** Mutable index state owned by the indexing writer. */
export type MutableIndexState = LinkIndex;

export interface IndexMutationResult {
	snapshot: MutableIndexState;
	changedFilePaths: Set<string>;
	changedLookupKeys: Set<string>;
	changedLinkSourcePaths: Set<string>;
	cacheInvalidationKeys: ReadonlySet<EdgeKey>;
	/**
	 * Whether canonical edges or lazily materialized link presentation may have changed.
	 * False for body-only changes without outgoing links.
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
	return createEmptyLinkIndex();
}
