import type { App, TFile } from "obsidian";
import type { TwoHopLinkBranch, TwoHopIndexedLink, TaggedNote } from "types/domain";
import type { SortOption } from "types/settings";

/**
 * ソート可能なアイテムの型
 */
export type SortableItem = TwoHopLinkBranch | TwoHopIndexedLink | TaggedNote | TFile;

/**
 * ソート処理に必要なコンテキスト
 */
export interface SortContext {
	app: App;
	sortOption: SortOption;
}

/**
 * 比較関数の型
 * 修正: SortableEntryではなく、SortableItemを直接比較するように変更
 */
export type Comparator<T = SortableItem> = (a: T, b: T) => number;

export type SortKey = string | number;

export interface SortResult<T extends SortableItem> {
	items: T[];
	orderChanged: boolean;
}
