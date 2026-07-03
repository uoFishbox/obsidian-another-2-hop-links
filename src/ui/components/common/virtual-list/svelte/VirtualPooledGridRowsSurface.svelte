<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import { IS_PROD } from "../../../../../appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey, MountedVirtualCell } from "../types";
	import VirtualGridLogicalCellMount from "./VirtualGridLogicalCellMount.svelte";
	import type {
		VirtualSurfaceMountedRow,
		VirtualSurfaceMountedRowSlot,
	} from "./VirtualSurfaceTypes";

	interface Props<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		mountedRows?: readonly VirtualSurfaceMountedRow<TMountedCell>[];
		mountedRowSlots?: readonly VirtualSurfaceMountedRowSlot<TMountedCell>[];
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
		mountedRows = [],
		mountedRowSlots = undefined,
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
	const createMountedRowSlot = (
		row: VirtualSurfaceMountedRow<TMountedCell>,
	): VirtualSurfaceMountedRowSlot<TMountedCell> => ({
		slotIndex: row.slotIndex ?? row.key,
		slotKey: resolveRowSlotKey(row),
		row,
	});
	const mountedRowsAsSlots = $derived.by(() => mountedRows.map(createMountedRowSlot));
	const rowSlots = $derived(mountedRowSlots ?? mountedRowsAsSlots);
	const resolveCellSlotKey = (
		_row: VirtualSurfaceMountedRow<TMountedCell>,
		cell: TMountedCell,
	): number => cell.cellSlotKey ?? cell.renderSlotIndex;

	const resolveRowCells = (
		row: VirtualSurfaceMountedRow<TMountedCell>,
		revision: number | undefined,
	): readonly TMountedCell[] => {
		void revision;
		return row.cells;
	};

	const resolveRowTop = (row: VirtualSurfaceMountedRow<TMountedCell>): string =>
		`${row.top}px`;

	const resolveMountedCellLogicalKey = (cell: TMountedCell): LogicalCellKey =>
		cell.key;

	const resolveMountedCellRowIndex = (cell: TMountedCell): number => cell.rowIndex;

	const resolveMountedCellColumnIndex = (cell: TMountedCell): number | undefined =>
		cell.columnIndex;

	const resolveMountedCellBodyKey = (cell: TMountedCell): unknown =>
		cell.renderBodyKey ?? cell.cellMetadataKey ?? cell.key;
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	{#each rowSlots as rowSlot (rowSlot.slotKey)}
		{#if rowSlot.row}
			{@const row = rowSlot.row}
			<div
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
				data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
				style:top={resolveRowTop(row)}
				{...row.attributes}
			>
				{#each resolveRowCells(row, rowSlot.revision) as mountedCell (resolveCellSlotKey(row, mountedCell))}
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
		{/if}
	{/each}
</div>
