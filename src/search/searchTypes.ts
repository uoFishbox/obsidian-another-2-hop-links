import type { Pos } from "obsidian";

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
	contentPreview?: string;
}

export interface SearchMatchesSnapshot {
	readonly matchesByKey: ReadonlyMap<string, SearchMatchedItem>;
	readonly firstContentMatchPositionByPath: ReadonlyMap<string, Pos>;
}
