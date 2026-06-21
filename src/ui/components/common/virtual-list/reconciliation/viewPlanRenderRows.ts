import type { MountedFlatCell } from "./viewPlanMountedCells";
import type { RowKey } from "../rowKey";

export interface MountedFlatRowSlice<T, G> {
	slotIndex?: number;
	slotKey?: number;
	rowIndex: number;
	rowKey: RowKey;
	key: RowKey;
	top: number;
	cells: MountedFlatCell<T, G>[];
}
