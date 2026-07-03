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

export interface VirtualSurfaceMountedRowSlot<TMountedCell extends MountedVirtualCell> {
	readonly slotIndex: number;
	readonly slotKey: number;
	readonly row: VirtualSurfaceMountedRow<TMountedCell> | null;
	readonly revision?: number;
}

export type VirtualSurfaceRenderInput<TMountedCell extends MountedVirtualCell> =
	| {
			layoutMode?: "absolute-cells";
			mountedCells: readonly TMountedCell[];
			mountedRows?: never;
			mountedRowSlots?: never;
	  }
	| (
			| {
					layoutMode: "grid-rows";
					mountedCells?: never;
					mountedRows: readonly VirtualSurfaceMountedRow<TMountedCell>[];
					mountedRowSlots?: never;
			  }
			| {
					layoutMode: "grid-rows";
					mountedCells?: never;
					mountedRows?: never;
					mountedRowSlots: readonly VirtualSurfaceMountedRowSlot<TMountedCell>[];
			  }
	  );
