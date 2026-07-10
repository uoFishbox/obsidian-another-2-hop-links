import type { RowKey } from "../rowKey";
import type { MountedVirtualCell } from "../types";

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
}

export type VirtualSurfaceRenderInput<TMountedCell extends MountedVirtualCell> =
	| {
			layoutMode?: "absolute-cells";
			mountedCells: readonly TMountedCell[];
			mountedRows?: never;
	  }
	| {
			layoutMode: "grid-rows";
			mountedCells?: never;
			mountedRows: readonly VirtualSurfaceMountedRow<TMountedCell>[];
	  };
