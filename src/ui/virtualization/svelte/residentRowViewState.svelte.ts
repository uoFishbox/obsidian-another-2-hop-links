import type { MountedVirtualCell } from "../types";
import type {
	VirtualSurfaceMountedRow,
	VirtualSurfaceResidentRowViewState,
} from "./VirtualSurfaceTypes";

export interface VirtualSurfaceResidentRowsAdapter<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell> & {
		readonly slotIndex: number;
	},
> {
	readonly rows: readonly VirtualSurfaceResidentRowViewState<
		TMountedCell,
		TMountedRow
	>[];
	sync(occupiedRowsInSlotOrder: readonly TMountedRow[]): void;
}

/**
 * Creates an active-slot reactive view over physical mounted-row slots.
 */
export function createVirtualSurfaceResidentRowsAdapter<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell> & {
		readonly slotIndex: number;
	},
>(): VirtualSurfaceResidentRowsAdapter<TMountedCell, TMountedRow> {
	type ResidentRow = VirtualSurfaceResidentRowViewState<TMountedCell, TMountedRow>;
	let residentRows = $state.raw<readonly ResidentRow[]>([]);
	const residentRowsBySlot = new Map<number, ResidentRow>();

	function sync(occupiedRowsInSlotOrder: readonly TMountedRow[]): void {
		const nextResidentRows: ResidentRow[] = [];
		const nextActiveSlots = new Set<number>();
		for (const row of occupiedRowsInSlotOrder) {
			const slotIndex = row.slotIndex;
			if (nextActiveSlots.has(slotIndex)) {
				if (process.env.NODE_ENV !== "production") {
					throw new Error(`Duplicate resident row slot: ${slotIndex}.`);
				}
				continue;
			}
			nextActiveSlots.add(slotIndex);
			let residentRow = residentRowsBySlot.get(slotIndex);
			if (!residentRow) {
				residentRow = createResidentRowViewState(slotIndex);
				residentRowsBySlot.set(slotIndex, residentRow);
			}
			if (residentRow.row !== row) residentRow.row = row;
			nextResidentRows.push(residentRow);
		}

		for (const slotIndex of residentRowsBySlot.keys()) {
			if (!nextActiveSlots.has(slotIndex)) residentRowsBySlot.delete(slotIndex);
		}
		if (!hasSameResidentRows(residentRows, nextResidentRows)) {
			residentRows = nextResidentRows;
		}
	}

	return {
		get rows() {
			return residentRows;
		},
		sync,
	};
}

function hasSameResidentRows<T>(current: readonly T[], next: readonly T[]): boolean {
	if (current.length !== next.length) return false;
	for (let index = 0; index < current.length; index += 1) {
		if (current[index] !== next[index]) return false;
	}
	return true;
}

function createResidentRowViewState<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell> & {
		readonly slotIndex: number;
	},
>(slotIndex: number): VirtualSurfaceResidentRowViewState<TMountedCell, TMountedRow> {
	let row = $state.raw<TMountedRow | undefined>(undefined);
	return {
		slotIndex,
		get row() {
			return row;
		},
		set row(nextRow) {
			row = nextRow;
		},
	};
}
