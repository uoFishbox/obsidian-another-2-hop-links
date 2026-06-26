<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import type { RowKey } from "../rowKey";
	import VirtualAbsoluteCellSurface from "./VirtualAbsoluteCellSurface.svelte";
	import VirtualPooledGridRowsSurface from "./VirtualPooledGridRowsSurface.svelte";

	export interface VirtualSurfaceCellPosition {
		top: number;
		left: number;
		width: number;
		height: number;
	}

	export interface VirtualSurfaceMountedRow<TMountedCell extends MountedVirtualCell> {
		key: RowKey;
		rowIndex: number;
		top: number;
		slotIndex?: number;
		slotKey?: number;
		attributes?: Record<string, string | number | undefined>;
		cells: readonly TMountedCell[];
	}

	interface Props<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		layoutMode?: "absolute-cells" | "grid-rows";
		mountedCells: readonly TMountedCell[];
		mountedRows?: readonly VirtualSurfaceMountedRow<TMountedCell>[];
		mountedRowsVersion?: number;
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellPosition?: (cell: TMountedCell) => VirtualSurfaceCellPosition;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		getRowRenderKey?: (rowIndex: number) => RowKey | undefined;
		getRowDataAttributes?: (
			rowIndex: number,
		) => Record<string, string | number | undefined> | undefined;
		onCellMount?: (cell: TMountedCell) => void;
		onCellDestroy?: (cell: TMountedCell) => void;
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
		layoutMode = "absolute-cells",
		mountedCells,
		mountedRows = undefined,
		mountedRowsVersion = undefined,
		contentEl = $bindable<HTMLDivElement | null>(null),
		observerRoot = null,
		getCellPosition,
		getCellClassName,
		getCellDataTestId,
		getRowRenderKey,
		getRowDataAttributes,
		onCellMount,
		onCellDestroy,
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
		{mountedCells}
		{mountedRows}
		{mountedRowsVersion}
		bind:contentEl
		{observerRoot}
		{getCellPosition}
		{getCellClassName}
		{getCellDataTestId}
		{getRowRenderKey}
		{getRowDataAttributes}
		onLogicalCellAttach={onCellMount}
		onLogicalCellDetach={onCellDestroy}
		{renderCell}
	/>
{:else}
	<VirtualAbsoluteCellSurface
		{contentClassName}
		{cellClassName}
		{contentHeight}
		{cellWidth}
		{rowHeight}
		{mountedCells}
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
