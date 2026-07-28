import type { Brand } from "../types";

declare const residentSlotPoolIdBrand: unique symbol;

/** Opaque identity of one resident-slot allocator instance. */
export interface ResidentSlotPoolId {
	readonly [residentSlotPoolIdBrand]: true;
}

/** Bounded physical row-slot position inside one allocator pool. */
export type RowSlotIndex = Brand<number, "RowSlotIndex">;

/** Flattened render-slot position of one cell inside the bounded grid. */
export type CellSlotIndex = Brand<number, "CellSlotIndex">;

export const rowSlotIndex = (value: number): RowSlotIndex => value as RowSlotIndex;

export const cellSlotIndex = (value: number): CellSlotIndex => value as CellSlotIndex;

/**
 * Captured ownership lease for one bounded physical **row** slot.
 *
 * `rowSlotGeneration` is the only generation counter in this module; it
 * advances exactly when the row slot is re-assigned to a different logical
 * row.
 */
export interface ResidentRowSlotLease {
	readonly poolId: ResidentSlotPoolId;
	readonly poolEpoch: number;
	readonly rowSlotIndex: RowSlotIndex;
	readonly rowSlotGeneration: number;
}

/**
 * Projection of one row-slot incarnation onto a flattened cell coordinate.
 *
 * This is **not** an ownership lease for the cell: it never changes while the
 * owning row lease stays the same, even when only the cell owner changes
 * within that logical row (e.g. `load-more → item`). Consumers that need to
 * detect cell-owner transitions must additionally compare the cell's logical
 * key (`MountedVirtualCell.key`) or publication revision.
 */
export interface ResidentCellSlotIncarnation {
	readonly rowLease: ResidentRowSlotLease;
	readonly cellSlotIndex: CellSlotIndex;
}

export function hasSameRowSlotLease(
	current: ResidentRowSlotLease,
	next: ResidentRowSlotLease,
): boolean {
	return (
		current.poolId === next.poolId &&
		current.poolEpoch === next.poolEpoch &&
		current.rowSlotIndex === next.rowSlotIndex &&
		current.rowSlotGeneration === next.rowSlotGeneration
	);
}

export function hasSameCellSlotIncarnation(
	current: ResidentCellSlotIncarnation,
	next: ResidentCellSlotIncarnation,
): boolean {
	return (
		current.cellSlotIndex === next.cellSlotIndex &&
		hasSameRowSlotLease(current.rowLease, next.rowLease)
	);
}
