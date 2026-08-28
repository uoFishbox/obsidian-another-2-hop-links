/** Immutable text and target identity used by one search run. */
export interface SearchItemSnapshot {
	key: string;
	searchText: string;
	targetFilePath: string | null;
}

export type SearchMatchScope = "title-only" | "title-and-content";

export interface SearchMatchedItem {
	key: string;
	contentMatched: boolean;
}

/** Offset-only match retained by search without scanning content for line numbers. */
export interface SearchContentMatch {
	readonly offset: number;
	readonly length: number;
}
