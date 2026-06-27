import type { App, TFile } from "obsidian";
import type { TwoHopLinkBranch, TwoHopIndexedLink, TaggedNote } from "types/domain";
import type { SortOption } from "types/settings";

export type SortableItem = TwoHopLinkBranch | TwoHopIndexedLink | TaggedNote | TFile;

export interface SortContext {
	app: App;
	sortOption: SortOption;
}

export type Comparator<T = SortableItem> = (a: T, b: T) => number;

export type SortKey = string | number;

export interface SortResult<T extends SortableItem> {
	items: T[];
	orderChanged: boolean;
}
