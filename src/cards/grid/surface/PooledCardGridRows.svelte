<script
	lang="ts"
	generics="TMountedCell extends MountedVirtualCell, TMountedRow extends CardGridMountedRow<TMountedCell>"
>
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "cards/virtualization/public";
	import {
		bindVirtualCell,
		type VirtualCellBindingRegistry,
	} from "../interaction/cellBindingRegistry";
	import type { CardGridMountedRow } from "./cardGridSurfaceTypes";

	const IS_PROD = process.env.NODE_ENV === "production";

	interface Props<
		TMountedCell extends MountedVirtualCell,
		TMountedRow extends CardGridMountedRow<TMountedCell>,
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
		scrollContainerEl?: HTMLElement | null;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		slotBodyRevision?: unknown;
		isRowActive?: (row: TMountedRow) => boolean;
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
		getCellClassName,
		getCellDataTestId,
		slotBodyRevision = undefined,
		isRowActive,
		cellBindingRegistry,
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
	{#each mountedRows as row (row.physicalRowSlot)}
		{#if !isRowActive || isRowActive(row)}
			<div
				{...row.attributes}
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? row.physicalRowSlot : undefined}
				data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
				use:setRowTop={row.top}
			>
				{#each row.bindings as currentBinding, columnIndex (row.physicalRowSlot * row.bindings.length + columnIndex)}
					{@const physicalCellSlotIndex =
						row.physicalRowSlot * row.bindings.length + columnIndex}
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
						class={currentBinding
							? resolveCellClassName(currentBinding)
							: cellClassName}
						data-ccl-logical-key={!IS_PROD
							? logicalKeyAttribute
							: undefined}
						data-ccl-cell-slot={!IS_PROD
							? physicalCellSlotIndex
							: undefined}
						data-testid={!IS_PROD && currentBinding
							? getCellDataTestId?.(currentBinding)
							: undefined}
						data-ccl-row-index={!IS_PROD ? mountedRowIndex : undefined}
						data-ccl-column-index={!IS_PROD
							? mountedColumnIndex
							: undefined}
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
		{/if}
	{/each}
</div>
