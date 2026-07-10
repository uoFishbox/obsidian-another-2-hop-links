<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import { IS_PROD } from "../../../../../appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey, MountedVirtualCell } from "../types";
	import VirtualGridLogicalCellMount from "./VirtualGridLogicalCellMount.svelte";
	import type { VirtualSurfaceMountedRow } from "./VirtualSurfaceTypes";

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
		onLogicalCellAttach?: (cell: TMountedCell) => void;
		onLogicalCellDetach?: (cell: TMountedCell) => void;
		remountCellBodyOnKeyChange?: boolean;
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
		onLogicalCellAttach,
		onLogicalCellDetach,
		remountCellBodyOnKeyChange = true,
		renderCell,
	}: Props<TMountedCell> = $props();

	const resolveCellClassName = (mountedCell: TMountedCell): string => {
		const extraClassName = getCellClassName?.(mountedCell);
		if (!extraClassName) return cellClassName;
		if (!cellClassName) return extraClassName;
		return `${cellClassName} ${extraClassName}`;
	};

	const contentStyle = $derived(
		`height:${contentHeight}px; position:relative; --ccl-box-height:${rowHeight}px; --ccl-cell-width:${cellWidth ?? 0}px; --ccl-columns:${Math.max(1, Math.floor(columns))}${gap !== undefined ? `; --ccl-box-gap:${gap}px` : ""}`,
	);

	const resolveRowSlotKey = (row: VirtualSurfaceMountedRow<TMountedCell>): number =>
		row.slotKey ?? row.key;
	const resolveCellSlotKey = (
		_row: VirtualSurfaceMountedRow<TMountedCell>,
		cell: TMountedCell,
	): number => cell.cellSlotKey ?? cell.renderSlotIndex;

	const resolveMountedCellLogicalKey = (cell: TMountedCell): LogicalCellKey =>
		cell.key;

	const resolveMountedCellRowIndex = (
		cell: TMountedCell,
	): number => cell.rowIndex;

	const resolveMountedCellColumnIndex = (
		cell: TMountedCell,
	): number | undefined => cell.columnIndex;

	const resolveMountedCellBodyKey = (
		cell: TMountedCell,
	): unknown => cell.renderBodyKey ?? cell.cellMetadataKey ?? cell.key;

	const resolveRowStyle = (
		row: VirtualSurfaceMountedRow<TMountedCell>,
	): string =>
		`position:absolute; left:0; right:0; top:${Math.max(
			0,
			row.top,
		)}px; margin-bottom:0`;

</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	<div data-ccl-virtual-flow-spacer="top" style:height="0px" aria-hidden="true"></div>
	{#each mountedRows as row (resolveRowSlotKey(row))}
		<div
			{...row.attributes}
			class={rowClassName}
			data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
			data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
			style={resolveRowStyle(row)}
		>
			{#each row.cells as mountedCell (resolveCellSlotKey(row, mountedCell))}
				<VirtualGridLogicalCellMount
					logicalKey={resolveMountedCellLogicalKey(mountedCell)}
					className={resolveCellClassName(mountedCell)}
					dataTestId={getCellDataTestId?.(mountedCell)}
					cellSlotKey={resolveCellSlotKey(row, mountedCell)}
					rowIndex={resolveMountedCellRowIndex(mountedCell)}
					columnIndex={resolveMountedCellColumnIndex(mountedCell)}
					{mountedCell}
					{onLogicalCellAttach}
					{onLogicalCellDetach}
				>
					{#if remountCellBodyOnKeyChange}
						{#key resolveMountedCellBodyKey(mountedCell)}
							{@render renderCell({
								mountedCell,
								observerRoot,
							})}
						{/key}
					{:else}
						{@render renderCell({
							mountedCell,
							observerRoot,
						})}
					{/if}
				</VirtualGridLogicalCellMount>
			{/each}
		</div>
	{/each}
	<div
		data-ccl-virtual-flow-spacer="bottom"
		style:height="0px"
		aria-hidden="true"
	></div>
</div>
