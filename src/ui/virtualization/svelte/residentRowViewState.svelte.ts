import type { MountedVirtualCell } from "../types";
import type {
	VirtualSurfaceMountedRow,
	VirtualSurfaceResidentRowViewState,
} from "./VirtualSurfaceTypes";

export interface VirtualSurfaceResidentRowsAdapter<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>,
> {
	readonly rows: readonly VirtualSurfaceResidentRowViewState<
		TMountedCell,
		TMountedRow
	>[];
	sync(rowsBySlot: readonly TMountedRow[], capacity: number): void;
	applyDelta(
		delta: VirtualSurfaceResidentRowsDelta<TMountedRow>,
		capacity: number,
	): void;
}

/** Row-slot changes applied without scanning the full resident capacity. */
export interface VirtualSurfaceResidentRowsDelta<
	TMountedRow extends { readonly slotIndex?: number },
> {
	readonly enteredRows: readonly TMountedRow[];
	readonly reboundRows: readonly TMountedRow[];
	readonly releasedSlotIndexes: readonly number[];
}

/**
 * Creates a fixed-capacity reactive view over physical mounted-row slots.
 *
 * `rowsBySlot` must be ordered by ascending physical slot and may omit holes.
 */
export function createVirtualSurfaceResidentRowsAdapter<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>,
>(): VirtualSurfaceResidentRowsAdapter<TMountedCell, TMountedRow> {
	type ResidentRow = VirtualSurfaceResidentRowViewState<TMountedCell, TMountedRow>;
	let residentRows = $state.raw<readonly ResidentRow[]>([]);

	function sync(rowsBySlot: readonly TMountedRow[], capacity: number): void {
		resize(capacity);

		let mountedRowOffset = 0;
		for (const residentRow of residentRows) {
			const candidate = rowsBySlot[mountedRowOffset];
			const nextRow =
				candidate?.slotIndex === residentRow.slotIndex ? candidate : undefined;
			if (nextRow) mountedRowOffset += 1;
			if (residentRow.row === nextRow) continue;
			residentRow.row = nextRow;
		}
	}

	function resize(capacity: number): void {
		const normalizedCapacity = Math.max(0, Math.floor(capacity));
		if (residentRows.length === normalizedCapacity) return;
		const nextRows = residentRows.slice(0, normalizedCapacity);
		for (
			let slotIndex = nextRows.length;
			slotIndex < normalizedCapacity;
			slotIndex += 1
		) {
			nextRows.push(
				createResidentRowViewState<TMountedCell, TMountedRow>(slotIndex),
			);
		}
		residentRows = nextRows;
	}

	function applyDelta(
		delta: VirtualSurfaceResidentRowsDelta<TMountedRow>,
		capacity: number,
	): void {
		resize(capacity);
		for (const slotIndex of delta.releasedSlotIndexes) {
			const residentRow = residentRows[slotIndex];
			if (residentRow?.row !== undefined) residentRow.row = undefined;
		}
		for (const row of delta.enteredRows) publishRow(row);
		for (const row of delta.reboundRows) publishRow(row);
	}

	function publishRow(row: TMountedRow): void {
		const slotIndex = row.slotIndex;
		if (slotIndex === undefined) return;
		const residentRow = residentRows[slotIndex];
		if (residentRow && residentRow.row !== row) residentRow.row = row;
	}

	return {
		get rows() {
			return residentRows;
		},
		sync,
		applyDelta,
	};
}

function createResidentRowViewState<
	TMountedCell extends MountedVirtualCell,
	TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>,
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
