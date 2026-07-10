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

	const resolvePhysicalRowSlotKey = (
		row: VirtualSurfaceMountedRow<TMountedCell>,
	): number => row.slotKey ?? row.slotIndex ?? row.key;

	const compareRowsByPhysicalSlot = (
		left: VirtualSurfaceMountedRow<TMountedCell>,
		right: VirtualSurfaceMountedRow<TMountedCell>,
	): number => resolvePhysicalRowSlotKey(left) - resolvePhysicalRowSlotKey(right);

	const resolveRowsInPhysicalSlotOrder = (
		rows: readonly VirtualSurfaceMountedRow<TMountedCell>[],
		_version: number | undefined,
	): readonly VirtualSurfaceMountedRow<TMountedCell>[] => {
		for (let index = 1; index < rows.length; index += 1) {
			if (
				resolvePhysicalRowSlotKey(rows[index - 1]) >
				resolvePhysicalRowSlotKey(rows[index])
			) {
				return [...rows].sort(compareRowsByPhysicalSlot);
			}
		}

		return rows;
	};

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
		resolvePhysicalRowSlotKey(row);
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
	const resolveRowTransform = (
		row: VirtualSurfaceMountedRow<TMountedCell>,
		_version: number | undefined,
	): string => `translateY(${row.top}px)`;

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

	const physicalSlotRows = $derived(
		resolveRowsInPhysicalSlotOrder(mountedRows, mountedRowsVersion),
	);
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	{#each physicalSlotRows as row (resolveRowSlotKey(row))}
		<div
			class={rowClassName}
			data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
			data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
			style:transform={resolveRowTransform(row, mountedRowsVersion)}
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
</div>
