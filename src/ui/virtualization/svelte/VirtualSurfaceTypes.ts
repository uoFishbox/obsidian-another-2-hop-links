import type { RowKey } from "../rowKey";
import type { MountedVirtualCell } from "../types";
import type { SectionedGridMountedCellSlot } from "../core/reconciliation/mountedSectionedGridRows";

export interface VirtualSurfaceCellPosition {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface VirtualSurfaceMountedRow<TMountedCell extends MountedVirtualCell> {
	key: RowKey;
	rowIndex: number;
	top: number;
	slotIndex?: number;
	slotKey?: number;
	attributes?: Record<string, string | number | undefined>;
	cells: readonly TMountedCell[];
	cellSlots?: readonly SectionedGridMountedCellSlot<TMountedCell>[];
}

/**
 * Reactive view state for one stable physical row slot.
 *
 * The containing array remains stable while capacity is unchanged. Adapters
 * replace only `row` when the logical row bound to this slot changes.
 */
export interface VirtualSurfaceResidentRowViewState<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell> =
		VirtualSurfaceMountedRow<TMountedCell>,
> {
	readonly slotIndex: number;
	row: TMountedRow | undefined;
}

export type VirtualSurfaceRenderInput<TMountedCell extends MountedVirtualCell> =
	| {
			layoutMode?: "absolute-cells";
			mountedCells: readonly TMountedCell[];
			mountedRows?: never;
			residentRows?: never;
	  }
	| {
			layoutMode: "grid-rows";
			mountedCells?: never;
			mountedRows: readonly VirtualSurfaceMountedRow<TMountedCell>[];
			residentRows?: never;
	  }
	| {
			layoutMode: "grid-rows";
			mountedCells?: never;
			mountedRows?: never;
			residentRows: readonly VirtualSurfaceResidentRowViewState<TMountedCell>[];
	  };
