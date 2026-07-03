import type { MountedVirtualCell } from "../types";
import type { VirtualSurfaceMountedRow } from "./VirtualSurfaceTypes";

export class VirtualSurfaceRowSlot<TMountedCell extends MountedVirtualCell> {
	readonly slotIndex: number;
	readonly slotKey: number;
	row = $state.raw<VirtualSurfaceMountedRow<TMountedCell> | null>(null);
	revision = $state(0);

	constructor(slotIndex: number) {
		this.slotIndex = slotIndex;
		this.slotKey = slotIndex;
	}

	setRow(next: VirtualSurfaceMountedRow<TMountedCell> | null): boolean {
		if (this.row === next) return false;
		this.row = next;
		this.revision += 1;
		return true;
	}

	refresh(): void {
		this.revision += 1;
	}
}
