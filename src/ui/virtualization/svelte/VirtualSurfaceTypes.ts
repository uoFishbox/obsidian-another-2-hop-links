import type { RowKey } from "../rowKey";
import type { MountedVirtualCell } from "../types";
import type { SectionedGridMountedCellSlot } from "../core/reconciliation/mountedSectionedGridRows";

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
