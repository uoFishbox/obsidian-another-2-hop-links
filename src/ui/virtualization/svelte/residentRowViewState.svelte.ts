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

	return {
		get rows() {
			return residentRows;
		},
		sync,
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
