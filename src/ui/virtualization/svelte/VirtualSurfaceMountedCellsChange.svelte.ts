import { untrack } from "svelte";
import type { MountedVirtualCell } from "../types";
import type { VirtualSurfaceRenderInput } from "./VirtualSurfaceTypes";

export interface VirtualSurfaceMountedCellsChangeOptions<
	TMountedCell extends MountedVirtualCell,
> {
	getRenderInput(): VirtualSurfaceRenderInput<TMountedCell>;
	getMountedCellsForChange(): readonly TMountedCell[] | undefined;
	onMountedCellsChange?: (cells: readonly TMountedCell[]) => void;
}

export function watchVirtualSurfaceMountedCellsChange<
	TMountedCell extends MountedVirtualCell,
>({
	getRenderInput,
	getMountedCellsForChange,
	onMountedCellsChange,
}: VirtualSurfaceMountedCellsChangeOptions<TMountedCell>): void {
	let lastNotifiedCells: readonly TMountedCell[] | undefined;

	function notifyMountedCellsChange(): void {
		if (!onMountedCellsChange) return;
		const renderInput = getRenderInput();
		const cells =
			getMountedCellsForChange() ??
			(renderInput.layoutMode === "grid-rows"
				? undefined
				: renderInput.mountedCells);
		if (!cells) return;
		if (cells === lastNotifiedCells) return;
		lastNotifiedCells = cells;
		untrack(() => onMountedCellsChange(cells));
	}

	$effect(() => {
		notifyMountedCellsChange();
	});
}
