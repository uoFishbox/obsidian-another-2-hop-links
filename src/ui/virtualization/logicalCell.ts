import type { LogicalCellKey, SourceKey } from "./types";
import type { RenderRevision } from "./renderRevision";

export type VirtualListLogicalCell<T> =
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
	itemRenderRevision?: RenderRevision;
}

export interface VirtualLoadMoreCell {
	kind: "load-more";
	key: LogicalCellKey;
}
