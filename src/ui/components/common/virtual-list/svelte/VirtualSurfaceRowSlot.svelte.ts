import type { MountedVirtualCell } from "../types";
import type { VirtualSurfaceMountedRow } from "./VirtualSurfaceTypes";

export class VirtualSurfaceRowSlot<TMountedCell extends MountedVirtualCell> {
	readonly slotIndex: number;
	readonly slotKey: number;
	row = $state.raw<VirtualSurfaceMountedRow<TMountedCell> | null>(null);

	constructor(slotIndex: number) {
		this.slotIndex = slotIndex;
		this.slotKey = slotIndex;
	}

	setRow(next: VirtualSurfaceMountedRow<TMountedCell> | null): boolean {
		if (this.row === next) return false;
		this.row = next;
		return true;
	}

	refreshRow(next: VirtualSurfaceMountedRow<TMountedCell>): void {
		this.row = null;
		this.row = next;
	}
}
