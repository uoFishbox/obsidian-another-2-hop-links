<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import {
		KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		type VirtualCellBodyLifecyclePolicy,
	} from "ui/virtualization/bodyLifecycle";
	import VirtualAbsoluteCellSurface from "./VirtualAbsoluteCellSurface.svelte";
	import VirtualPooledGridRowsSurface from "./VirtualPooledGridRowsSurface.svelte";
	import type {
		VirtualSurfaceCellPosition,
		VirtualSurfaceRenderInput,
	} from "./VirtualSurfaceTypes";

	interface CommonProps<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellPosition?: (cell: TMountedCell) => VirtualSurfaceCellPosition;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		onCellMount?: (cell: TMountedCell) => void;
		onCellDestroy?: (cell: TMountedCell) => void;
		bodyLifecyclePolicy?: VirtualCellBodyLifecyclePolicy<TMountedCell>;
		renderCell: Snippet<
			[
				{
					mountedCell: TMountedCell;
					observerRoot: HTMLElement | null;
				},
			]
		>;
	}

	type Props<TMountedCell extends MountedVirtualCell> = CommonProps<TMountedCell> &
		VirtualSurfaceRenderInput<TMountedCell>;

	let {
		contentClassName = "",
		rowClassName = "",
		cellClassName = "",
		contentHeight,
		cellWidth = undefined,
		rowHeight,
		columns = 1,
		gap = undefined,
		layoutMode = "absolute-cells",
		mountedCells = undefined,
		mountedRows = undefined,
		contentEl = $bindable<HTMLDivElement | null>(null),
		observerRoot = null,
		getCellPosition,
		getCellClassName,
		getCellDataTestId,
		onCellMount,
		onCellDestroy,
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		renderCell,
	}: Props<TMountedCell> = $props();
</script>

{#if layoutMode === "grid-rows"}
	<VirtualPooledGridRowsSurface
		{contentClassName}
		{rowClassName}
		{cellClassName}
		{contentHeight}
		{cellWidth}
		{rowHeight}
		{columns}
		{gap}
		mountedRows={mountedRows ?? []}
		bind:contentEl
		{observerRoot}
		{getCellClassName}
		{getCellDataTestId}
		onLogicalCellAttach={onCellMount}
		onLogicalCellDetach={onCellDestroy}
		{bodyLifecyclePolicy}
		{renderCell}
	/>
{:else}
	<VirtualAbsoluteCellSurface
		{contentClassName}
		{cellClassName}
		{contentHeight}
		{cellWidth}
		{rowHeight}
		mountedCells={mountedCells ?? []}
		bind:contentEl
		{observerRoot}
		{getCellPosition}
		{getCellClassName}
		{getCellDataTestId}
		{onCellMount}
		{onCellDestroy}
		{renderCell}
	/>
{/if}
