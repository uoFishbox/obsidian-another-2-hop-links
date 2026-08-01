import { untrack } from "svelte";
import type { MountedVirtualCell } from "../types";

export interface VirtualSurfaceMountedCellsChangeOptions<
	TMountedCell extends MountedVirtualCell,
> {
	getMountedCellsForChange(): readonly TMountedCell[] | undefined;
	onMountedCellsChange?: (cells: readonly TMountedCell[]) => void;
}

export function watchVirtualSurfaceMountedCellsChange<
	TMountedCell extends MountedVirtualCell,
>({
	getMountedCellsForChange,
	onMountedCellsChange,
}: VirtualSurfaceMountedCellsChangeOptions<TMountedCell>): void {
	let lastNotifiedCells: readonly TMountedCell[] | undefined;

	function notifyMountedCellsChange(): void {
		if (!onMountedCellsChange) return;
		const cells = getMountedCellsForChange();
		if (!cells) return;
		if (cells === lastNotifiedCells) return;
		lastNotifiedCells = cells;
		untrack(() => onMountedCellsChange(cells));
	}

	$effect(() => {
		notifyMountedCellsChange();
	});
}
