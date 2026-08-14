<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import {
		KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		type VirtualCellBodyLifecyclePolicy,
	} from "ui/virtualization/core/bodyLifecycle";
	import VirtualPooledGridRowsSurface from "./VirtualPooledGridRowsSurface.svelte";
	import type { VirtualSurfaceMountedRow } from "./VirtualSurfaceTypes";
	import type { VirtualGridSurfaceTransaction } from "./VirtualGridSurfaceTransaction";

	interface Props<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		mountedRows: readonly VirtualSurfaceMountedRow<TMountedCell>[];
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		bodyLifecyclePolicy?: VirtualCellBodyLifecyclePolicy<TMountedCell>;
		surfaceTransaction: VirtualGridSurfaceTransaction;
		renderCell: Snippet<
			[
				{
					mountedCell: TMountedCell;
					observerRoot: HTMLElement | null;
				},
			]
		>;
	}

	let {
		contentClassName = "",
		rowClassName = "",
		cellClassName = "",
		contentHeight,
		cellWidth = undefined,
		rowHeight,
		columns = 1,
		gap = undefined,
		mountedRows,
		contentEl = $bindable<HTMLDivElement | null>(null),
		observerRoot = null,
		getCellClassName,
		getCellDataTestId,
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		surfaceTransaction,
		renderCell,
	}: Props<TMountedCell> = $props();
</script>

<VirtualPooledGridRowsSurface
	{contentClassName}
	{rowClassName}
	{cellClassName}
	{contentHeight}
	{cellWidth}
	{rowHeight}
	{columns}
	{gap}
	{mountedRows}
	bind:contentEl
	{observerRoot}
	{getCellClassName}
	{getCellDataTestId}
	{bodyLifecyclePolicy}
	{surfaceTransaction}
	{renderCell}
/>
