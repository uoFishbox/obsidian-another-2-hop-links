import type { MountedFlatRowSlice } from "ui/components/common/virtual-list/core/reconciliation/viewPlanRenderRows";

export class TwoHopRowSlot<TCell, TSection> {
	readonly slotIndex: number;
	readonly slotKey: number;
	row = $state.raw<MountedFlatRowSlice<TCell, TSection> | null>(null);

	constructor(slotIndex: number) {
		this.slotIndex = slotIndex;
		this.slotKey = slotIndex;
	}

	setRow(next: MountedFlatRowSlice<TCell, TSection> | null): boolean {
		if (this.row === next) return false;
		this.row = next;
		return true;
	}

	refreshRow(next: MountedFlatRowSlice<TCell, TSection>): void {
		this.row = null;
		this.row = next;
	}
}
