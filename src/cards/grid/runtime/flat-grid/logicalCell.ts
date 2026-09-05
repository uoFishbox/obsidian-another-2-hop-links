import type { LogicalCellKey, SourceKey } from "cards/virtualization/public";

export type FlatGridLogicalCell<T> =
	| FlatGridHeaderCell
	| FlatGridItemCell<T>
	| FlatGridLoadMoreCell;

export interface FlatGridHeaderCell {
	kind: "header";
	key: LogicalCellKey;
}

export interface FlatGridItemCell<T> {
	kind: "item";
	key: LogicalCellKey;
	sourceKey: SourceKey;
	item: T;
	itemIndex: number;
}

export interface FlatGridLoadMoreCell {
	kind: "load-more";
	key: LogicalCellKey;
}
