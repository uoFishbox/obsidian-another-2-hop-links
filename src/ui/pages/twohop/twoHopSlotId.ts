export interface TwoHopSlotIdCell {
	readonly cellSlotKey?: number;
	readonly renderSlotIndex: number;
}

export function resolveTwoHopSlotId(cell: TwoHopSlotIdCell): string {
	const slotIndex = cell.cellSlotKey ?? cell.renderSlotIndex;
	return `slot:${slotIndex}`;
}
