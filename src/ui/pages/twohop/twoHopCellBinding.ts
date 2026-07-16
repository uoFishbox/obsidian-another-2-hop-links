import type { LogicalCellKey } from "ui/components/common/virtual-list/types";
import type { TwoHopMountedCell } from "./twoHopMountedTypes";
import type { RenderBodyKey } from "ui/components/common/virtual-list/renderRevision";
import {
	resolveTwoHopItemStaticState,
	type TwoHopCardPresentationState,
	type TwoHopCellStaticState,
	type TwoHopItemReuseFamily,
} from "./twoHopCellStaticState";

export type {
	TwoHopCardPresentationState,
	TwoHopCardSectionVariant,
	TwoHopItemReuseFamily,
} from "./twoHopCellStaticState";

/** Complete, committed state for one physical cell's current logical binding. */
export interface TwoHopCellBinding {
	readonly epoch: number;
	readonly logicalKey: LogicalCellKey;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderKind: TwoHopMountedCell["renderBodyKind"];
	readonly reuseFamily: TwoHopItemReuseFamily | null;
	readonly presentation: TwoHopCardPresentationState | null;
	readonly interactionId: string | null;
	readonly mountedCell: TwoHopRenderCellSnapshot;
}

type TwoHopMountedHeaderCell = Extract<TwoHopMountedCell, { cell: { kind: "header" } }>;
type TwoHopMountedItemCell = Extract<TwoHopMountedCell, { cell: { kind: "item" } }>;
type TwoHopMountedLoadMoreCell = Extract<
	TwoHopMountedCell,
	{ cell: { kind: "load-more" } }
>;

interface TwoHopRenderCellSnapshotBase<TCell extends TwoHopMountedCell["cell"]> {
	readonly key: LogicalCellKey;
	readonly renderSlotIndex: number;
	readonly cellSlotKey: number | undefined;
	readonly cell: TCell;
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly sectionId: string;
	readonly renderBodyKey: RenderBodyKey | undefined;
	readonly renderBodyKind: TwoHopMountedCell["renderBodyKind"];
	readonly section: TwoHopMountedCell["section"];
	readonly compiledCell: TwoHopMountedCell["compiledCell"];
}

type TwoHopRenderHeaderCellSnapshot = TwoHopRenderCellSnapshotBase<
	TwoHopMountedHeaderCell["cell"]
> &
	Pick<TwoHopMountedHeaderCell, "title" | "totalCount" | "headerProps">;

/** Minimal immutable item view consumed by fixed-slot item renderers. */
export type TwoHopRenderItemCellSnapshot = TwoHopRenderCellSnapshotBase<
	TwoHopMountedItemCell["cell"]
>;

type TwoHopRenderLoadMoreCellSnapshot = TwoHopRenderCellSnapshotBase<
	TwoHopMountedLoadMoreCell["cell"]
>;

/** Minimal immutable view consumed by the fixed-slot render surface. */
export type TwoHopRenderCellSnapshot =
	| TwoHopRenderHeaderCellSnapshot
	| TwoHopRenderItemCellSnapshot
	| TwoHopRenderLoadMoreCellSnapshot;

export { resolveTwoHopSectionVariant } from "./twoHopCellStaticState";

function resolveStaticState(cell: TwoHopRenderCellSnapshot): TwoHopCellStaticState {
	if (cell.compiledCell?.logicalKey === cell.key) return cell.compiledCell;
	if (cell.cell.kind === "item") {
		return resolveTwoHopItemStaticState(cell.cell.item, cell.section);
	}

	return { reuseFamily: null, presentation: null, interactionId: null };
}

function createRenderCellSnapshot(cell: TwoHopMountedCell): TwoHopRenderCellSnapshot {
	const logicalCell = cell.cell;
	const base = {
		key: cell.key,
		renderSlotIndex: cell.renderSlotIndex,
		cellSlotKey: cell.cellSlotKey,
		rowIndex: cell.rowIndex,
		columnIndex: cell.columnIndex,
		sectionId: cell.sectionId,
		renderBodyKey: cell.renderBodyKey,
		renderBodyKind: cell.renderBodyKind,
		section: cell.section,
		compiledCell: cell.compiledCell,
	};

	if (logicalCell.kind === "header") {
		const headerCell = cell as TwoHopMountedHeaderCell;
		return {
			...base,
			cell: { ...logicalCell },
			title: headerCell.title,
			totalCount: headerCell.totalCount,
			headerProps: headerCell.headerProps,
		};
	}

	if (logicalCell.kind === "item") {
		return {
			...base,
			cell: { ...logicalCell },
		};
	}

	return {
		...base,
		cell: { ...logicalCell },
	};
}

/** Builds the single snapshot committed by a physical slot rebind. */
export function createTwoHopCellBinding(
	cell: TwoHopMountedCell,
	epoch: number,
): TwoHopCellBinding {
	const mountedCell = createRenderCellSnapshot(cell);
	const staticState = resolveStaticState(mountedCell);

	return {
		epoch,
		logicalKey: mountedCell.key,
		rowIndex: mountedCell.rowIndex,
		columnIndex: mountedCell.columnIndex,
		renderBodyKey: mountedCell.renderBodyKey,
		renderKind: mountedCell.renderBodyKind,
		...staticState,
		mountedCell,
	};
}
