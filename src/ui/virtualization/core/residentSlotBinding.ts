/** Captured ownership lease for one bounded physical render slot. */
export interface ResidentSlotBindingToken {
	readonly slotIndex: number;
	readonly epoch: number;
}
