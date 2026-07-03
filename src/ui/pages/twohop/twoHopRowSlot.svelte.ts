import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";

export class TwoHopRowSlot<TCell, TSection> {
	readonly slotIndex: number;
	readonly slotKey: number;
	row = $state.raw<MountedFlatRowSlice<TCell, TSection> | null>(null);
	revision = $state(0);

	constructor(slotIndex: number) {
		this.slotIndex = slotIndex;
		this.slotKey = slotIndex;
	}

	setRow(next: MountedFlatRowSlice<TCell, TSection> | null): boolean {
		if (this.row === next) return false;
		this.row = next;
		this.revision += 1;
		return true;
	}

	refresh(): void {
		this.revision += 1;
	}
}
