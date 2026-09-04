<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import { untrack } from "svelte";
	import type { MountedVirtualCell } from "cards/virtualization/public";
	import {
		bindVirtualCell,
		type VirtualCellBindingRegistry,
	} from "../interaction/cellBindingRegistry";
	import type { CardGridMountedRow } from "./cardGridSurfaceTypes";
	import { createPhysicalGridSlotPool } from "./physicalGridSlotPool.svelte";

	const IS_PROD = process.env.NODE_ENV === "production";

	interface Props<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		mountedRows: readonly CardGridMountedRow<TMountedCell>[];
		contentEl?: HTMLDivElement | null;
		scrollContainerEl?: HTMLElement | null;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		slotBodyRevision?: unknown;
		cellBindingRegistry: VirtualCellBindingRegistry;
		renderCell: Snippet<
			[
				{
					mountedCell: TMountedCell;
					scrollContainerEl: HTMLElement | null;
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
		scrollContainerEl = null,
		getCellDataTestId,
		slotBodyRevision = undefined,
		cellBindingRegistry,
		renderCell,
	}: Props<TMountedCell> = $props();

	const physicalSlotPool = createPhysicalGridSlotPool<TMountedCell>();

	$effect.pre(() => {
		const nextMountedRows = mountedRows;
		const nextColumns = columns;
		untrack(() => physicalSlotPool.sync(nextMountedRows, nextColumns));
	});

	const contentStyle = $derived(
		`height:${contentHeight}px; position:relative; --ccl-box-height:${rowHeight}px; --ccl-cell-width:${cellWidth ?? 0}px; --ccl-columns:${Math.max(1, Math.floor(columns))}${gap !== undefined ? `; --ccl-box-gap:${gap}px` : ""}`,
	);
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	{#each physicalSlotPool.rows as row (row.physicalRowSlot)}
		<div
			class={rowClassName}
			hidden={!row.active}
			aria-hidden={!row.active ? "true" : undefined}
			data-ccl-row-slot={!IS_PROD ? row.physicalRowSlot : undefined}
			data-ccl-row-index={!IS_PROD && row.active ? row.rowIndex : undefined}
			style:top={`${Math.max(0, row.top)}px`}
		>
			{#each row.cells as cell (cell.physicalCellSlot)}
				{@const currentBinding = cell.binding}
				{@const columnIndex =
					cell.physicalCellSlot - row.physicalRowSlot * row.cells.length}
				{@const physicalCellSlotIndex = cell.physicalCellSlot}
				{@const logicalKeyAttribute = currentBinding
					? String(currentBinding.key)
					: undefined}
				{@const mountedRowIndex = currentBinding
					? currentBinding.rowIndex
					: row.rowIndex}
				{@const mountedColumnIndex = currentBinding
					? currentBinding.columnIndex
					: columnIndex}
				<div
					use:bindVirtualCell={logicalKeyAttribute === undefined
						? undefined
						: {
								registry: cellBindingRegistry,
								nextLogicalKey: logicalKeyAttribute,
								rowIndex: mountedRowIndex,
								columnIndex: mountedColumnIndex,
							}}
					class={cellClassName}
					data-ccl-logical-key={!IS_PROD ? logicalKeyAttribute : undefined}
					data-ccl-cell-slot={!IS_PROD ? physicalCellSlotIndex : undefined}
					data-testid={!IS_PROD && currentBinding
						? getCellDataTestId?.(currentBinding)
						: undefined}
					data-ccl-row-index={!IS_PROD ? mountedRowIndex : undefined}
					data-ccl-column-index={!IS_PROD ? mountedColumnIndex : undefined}
					aria-hidden={currentBinding === null ? "true" : undefined}
				>
					{#key slotBodyRevision}
						{#if currentBinding}
							{@const mountedCell = currentBinding}
							{@render renderCell({
								mountedCell,
								scrollContainerEl,
							})}
						{/if}
					{/key}
				</div>
			{/each}
		</div>
	{/each}
</div>
