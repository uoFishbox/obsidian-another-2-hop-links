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
		mountedRowsVersion?: number;
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
		mountedRowsVersion = undefined,
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

	/**
	 * Helper functions that take `mountedRowsVersion` as a parameter to ensure
	 * Svelte re-reads mutated row/cell properties when the version changes.
	 *
	 * Without passing version into the expression, Svelte's compiler may skip
	 * re-evaluation because the object identity has not changed.
	 */
	const resolveTopSpacerHeight = (
		rows: readonly VirtualSurfaceMountedRow<TMountedCell>[],
		_version: number | undefined,
	): number => Math.max(0, rows[0]?.top ?? 0);

	const resolveRowBottomSpacing = (
		rows: readonly VirtualSurfaceMountedRow<TMountedCell>[],
		rowIndex: number,
		currentRowHeight: number,
		_version: number | undefined,
	): number => {
		const row = rows[rowIndex];
		const nextRow = rows[rowIndex + 1];
		if (!row || !nextRow) return 0;
		return Math.max(0, nextRow.top - (row.top + currentRowHeight));
	};

	const resolveBottomSpacerHeight = (
		rows: readonly VirtualSurfaceMountedRow<TMountedCell>[],
		currentContentHeight: number,
		currentRowHeight: number,
		_version: number | undefined,
	): number => {
		const lastRow = rows[rows.length - 1];
		if (!lastRow) return Math.max(0, currentContentHeight);
		return Math.max(0, currentContentHeight - (lastRow.top + currentRowHeight));
	};

	const resolveMountedCellLogicalKey = (
		cell: TMountedCell,
		_version: number | undefined,
	): LogicalCellKey => cell.key;

	const resolveMountedCellRowIndex = (
		cell: TMountedCell,
		_version: number | undefined,
	): number => cell.rowIndex;

	const resolveMountedCellColumnIndex = (
		cell: TMountedCell,
		_version: number | undefined,
	): number | undefined => cell.columnIndex;

	const resolveMountedCellBodyKey = (
		cell: TMountedCell,
		_version: number | undefined,
	): unknown => cell.renderBodyKey ?? cell.cellMetadataKey ?? cell.key;
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	<div
		data-ccl-virtual-flow-spacer="top"
		style:height={`${resolveTopSpacerHeight(mountedRows, mountedRowsVersion)}px`}
		aria-hidden="true"
	></div>
	{#each mountedRows as row, rowIndex (resolveRowSlotKey(row))}
		<div
			class={rowClassName}
			data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
			data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
			style:margin-bottom={`${resolveRowBottomSpacing(
				mountedRows,
				rowIndex,
				rowHeight,
				mountedRowsVersion,
			)}px`}
			{...row.attributes}
		>
			{#each row.cells as mountedCell (resolveCellSlotKey(row, mountedCell))}
				<VirtualGridLogicalCellMount
					logicalKey={resolveMountedCellLogicalKey(
						mountedCell,
						mountedRowsVersion,
					)}
					className={resolveCellClassName(mountedCell)}
					dataTestId={getCellDataTestId?.(mountedCell)}
					cellSlotKey={resolveCellSlotKey(row, mountedCell)}
					rowIndex={resolveMountedCellRowIndex(
						mountedCell,
						mountedRowsVersion,
					)}
					columnIndex={resolveMountedCellColumnIndex(
						mountedCell,
						mountedRowsVersion,
					)}
					{mountedCell}
					{onLogicalCellAttach}
					{onLogicalCellDetach}
				>
					{#if remountCellBodyOnKeyChange}
						{#key resolveMountedCellBodyKey(mountedCell, mountedRowsVersion)}
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
		style:height={`${resolveBottomSpacerHeight(
			mountedRows,
			contentHeight,
			rowHeight,
			mountedRowsVersion,
		)}px`}
		aria-hidden="true"
	></div>
</div>
