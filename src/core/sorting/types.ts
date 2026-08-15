import type { TFile } from "obsidian";
import type { TwoHopLinkBranch, TwoHopIndexedLink, TaggedNote } from "types/domain";

export type SortOption =
	| "alphabetical"
	| "alphabetical-reverse"
	| "created-date"
	| "created-date-reverse"
	| "modified-date"
	| "modified-date-reverse"
	| "backlink-count"
	| "backlink-count-reverse"
	| "file-size"
	| "file-size-reverse";

export type SortableItem = TwoHopLinkBranch | TwoHopIndexedLink | TaggedNote | TFile;

export type Comparator<T = SortableItem> = (a: T, b: T) => number;

export type SortKey = string | number;

export interface SortResult<T extends SortableItem> {
	readonly items: readonly T[];
	readonly orderChanged: boolean;
}

/** Dynamic configuration read while resolving metrics used by sorting. */
export interface SortingConfiguration {
	readonly frontmatterKeyCreatedDate: string;
	readonly frontmatterKeyModifiedDate: string;
	readonly priorityFrontmatterKeyForTitle?: string;
}

export type SortMetricKind =
	| "displayName"
	| "outgoingLinkCount"
	| "createdTime"
	| "modifiedTime"
	| "backlinkCount"
	| "fileSize";

/** Supplies domain metrics without coupling sort algorithms to data sources. */
export interface IMetricProvider {
	getDisplayName(item: SortableItem): string;
	getOutgoingLinkCount(item: SortableItem): number;
	getCreatedTime(item: SortableItem): number;
	getModifiedTime(item: SortableItem): number;
	getBacklinkCount(item: SortableItem): number;
	getFileSize(item: SortableItem): number;
	/**
	 * Returns the stable object identity shared by items whose metric value
	 * can be reused until the sort cache is invalidated.
	 */
	getMetricCacheIdentity?(
		metricKind: SortMetricKind,
		item: SortableItem,
	): object | undefined;
}

/** Sorts supported domain items according to a declared sort option. */
export interface ISortService {
	sort<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): readonly T[];
	sortWithResult?<T extends SortableItem>(
		items: readonly T[],
		sortOption: SortOption,
	): SortResult<T>;
}
