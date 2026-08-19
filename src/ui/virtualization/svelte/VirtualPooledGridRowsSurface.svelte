<script
	lang="ts"
	generics="TMountedCell extends MountedVirtualCell, TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>"
>
	import { IS_PROD } from "appConstants";
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import {
		bindVirtualGridCell,
		type VirtualGridSurfaceTransaction,
	} from "./VirtualGridSurfaceTransaction";
	import type { VirtualSurfaceMountedRow } from "./VirtualSurfaceTypes";

	interface Props<
		TMountedCell extends MountedVirtualCell,
		TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>,
	> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		mountedRows: readonly TMountedRow[];
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		bodyRevision?: unknown;
		isRowActive?: (row: TMountedRow) => boolean;
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
		bodyRevision = undefined,
		isRowActive,
		surfaceTransaction,
		renderCell,
	}: Props<TMountedCell, TMountedRow> = $props();

	const resolveCellClassName = (mountedCell: TMountedCell): string => {
		const extraClassName = getCellClassName?.(mountedCell);
		if (!extraClassName) return cellClassName;
		if (!cellClassName) return extraClassName;
		return `${cellClassName} ${extraClassName}`;
	};

	const contentStyle = $derived(
		`height:${contentHeight}px; position:relative; --ccl-box-height:${rowHeight}px; --ccl-cell-width:${cellWidth ?? 0}px; --ccl-columns:${Math.max(1, Math.floor(columns))}${gap !== undefined ? `; --ccl-box-gap:${gap}px` : ""}`,
	);

	const setRowTop = (element: HTMLElement, top: number) => {
		let committedTop = Number.NaN;

		const update = (nextTop: number): void => {
			const normalizedTop = Math.max(0, nextTop);
			if (normalizedTop === committedTop) return;

			committedTop = normalizedTop;
			element.style.top = `${normalizedTop}px`;
		};
		update(top);
		return { update };
	};
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	{#each mountedRows as row (row.slotIndex)}
		{#if !isRowActive || isRowActive(row)}
			<div
				{...row.attributes}
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
				data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
				use:setRowTop={row.top}
			>
				{#each row.bindings as currentBinding, columnIndex (row.slotIndex * row.bindings.length + columnIndex)}
					{@const renderSlotIndex =
						row.slotIndex * row.bindings.length + columnIndex}
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
						use:bindVirtualGridCell={logicalKeyAttribute === undefined
							? undefined
							: {
									transaction: surfaceTransaction,
									nextLogicalKey: logicalKeyAttribute,
									rowIndex: mountedRowIndex,
									columnIndex: mountedColumnIndex,
								}}
						class={currentBinding
							? resolveCellClassName(currentBinding)
							: cellClassName}
						data-ccl-logical-key={!IS_PROD
							? logicalKeyAttribute
							: undefined}
						data-ccl-cell-slot={!IS_PROD ? renderSlotIndex : undefined}
						data-testid={!IS_PROD && currentBinding
							? getCellDataTestId?.(currentBinding)
							: undefined}
						data-ccl-row-index={!IS_PROD ? mountedRowIndex : undefined}
						data-ccl-column-index={!IS_PROD
							? mountedColumnIndex
							: undefined}
						aria-hidden={currentBinding === null ? "true" : undefined}
					>
						{#key bodyRevision}
							{#if currentBinding}
								{@const mountedCell = currentBinding}
								{@render renderCell({
									mountedCell,
									observerRoot,
								})}
							{/if}
						{/key}
					</div>
				{/each}
			</div>
		{/if}
	{/each}
</div>
