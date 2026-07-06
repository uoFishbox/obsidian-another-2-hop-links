const SLOT_ID_BY_INDEX: string[] = [];

export interface TwoHopSlotIdCell {
	readonly cellSlotKey?: number;
	readonly renderSlotIndex: number;
}

export function resolveTwoHopSlotId(cell: TwoHopSlotIdCell): string {
	const slotIndex = cell.cellSlotKey ?? cell.renderSlotIndex;
	return (
		SLOT_ID_BY_INDEX[slotIndex] ??
		(SLOT_ID_BY_INDEX[slotIndex] = `slot:${slotIndex}`)
	);
}
