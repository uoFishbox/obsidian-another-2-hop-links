import type { MountedVirtualCell } from "ui/virtualization/public";

/** Physical row rendered by the reusable card-grid surface. */
export interface CardGridMountedRow<TMountedCell extends MountedVirtualCell> {
	rowIndex: number;
	top: number;
	physicalRowSlot: number;
	attributes?: Record<string, string | number | undefined>;
	/** Stable physical column bindings; null keeps an empty physical slot mounted. */
	bindings: readonly (TMountedCell | null)[];
}
