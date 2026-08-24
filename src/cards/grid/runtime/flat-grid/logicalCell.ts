import type { LogicalCellKey, SourceKey } from "cards/virtualization/public";

export type FlatGridLogicalCell<T> =
	| VirtualHeaderCell
	| VirtualItemCell<T>
	| VirtualLoadMoreCell;

export interface VirtualHeaderCell {
	kind: "header";
	key: LogicalCellKey;
}

export interface VirtualItemCell<T> {
	kind: "item";
	key: LogicalCellKey;
	sourceKey: SourceKey;
	item: T;
	itemIndex: number;
}

export interface VirtualLoadMoreCell {
	kind: "load-more";
	key: LogicalCellKey;
}
