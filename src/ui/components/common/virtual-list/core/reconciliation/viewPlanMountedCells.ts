import type { SectionRenderDescriptor } from "../../../../sections/types";
import type { VirtualListLogicalCell } from "../../logicalCell";
import type { RenderBodyKey } from "../../renderRevision";
import type { LogicalCellKey, RenderSlotKey } from "../../types";
import type { MountedRenderBodyIdentity } from "./renderBodyRevision";

type HeaderProps<T, G> = SectionRenderDescriptor<T, G>["headerProps"];
type HeaderLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "header" }>;
type ItemLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "item" }>;
type LoadMoreLogicalCell<T> = Extract<VirtualListLogicalCell<T>, { kind: "load-more" }>;

export interface MountedFlatCellPosition {
	readonly row: number;
	readonly column: number;
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

interface MountedFlatCellBase<T> extends MountedRenderBodyIdentity {
	readonly key: LogicalCellKey;
	readonly logicalKey: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly renderSlotKey: RenderSlotKey;
	readonly cell: VirtualListLogicalCell<T>;
	readonly rowIndex: number;
	readonly rowIndexInSection: number;
	readonly columnIndex: number;
	readonly rowTop: number;
	readonly sectionId: string;
	readonly cellMetadataKey?: unknown;
	readonly renderBodyKey?: RenderBodyKey;
	readonly position?: MountedFlatCellPosition;
	readonly cellSlotKey?: number;
}

export interface MountedFlatHeaderCell<T, G> extends MountedFlatCellBase<T> {
	readonly cell: HeaderLogicalCell<T>;
	readonly section: G;
	readonly title: string;
	readonly totalCount: number;
	readonly headerProps: HeaderProps<T, G>;
}

export interface MountedFlatItemCell<T, G> extends MountedFlatCellBase<T> {
	readonly cell: ItemLogicalCell<T>;
	readonly section: G;
}

export interface MountedFlatLoadMoreCell<T, G> extends MountedFlatCellBase<T> {
	readonly cell: LoadMoreLogicalCell<T>;
	readonly section: G;
}

export type MountedFlatCell<T, G> =
	| MountedFlatHeaderCell<T, G>
	| MountedFlatItemCell<T, G>
	| MountedFlatLoadMoreCell<T, G>;
