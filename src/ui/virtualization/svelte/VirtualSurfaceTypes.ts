import type { RowKey } from "../rowKey";
import type { MountedVirtualCell } from "../types";

export interface VirtualSurfaceMountedRow<TMountedCell extends MountedVirtualCell> {
	key: RowKey;
	rowIndex: number;
	top: number;
	slotIndex: number;
	attributes?: Record<string, string | number | undefined>;
	/** Stable physical column bindings; null keeps an empty physical slot mounted. */
	bindings: readonly (TMountedCell | null)[];
}
