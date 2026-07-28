declare const residentSlotPoolIdBrand: unique symbol;

/** Opaque identity of one resident-slot allocator instance. */
export interface ResidentSlotPoolId {
	readonly [residentSlotPoolIdBrand]: true;
}

/** Captured ownership lease for one bounded physical slot. */
export interface ResidentSlotLeaseToken {
	readonly poolId: ResidentSlotPoolId;
	readonly poolEpoch: number;
	readonly slotIndex: number;
	readonly slotGeneration: number;
}

/** @deprecated Use `ResidentSlotLeaseToken`. */
export type ResidentSlotBindingToken = ResidentSlotLeaseToken;
