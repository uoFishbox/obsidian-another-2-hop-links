<script
	lang="ts"
	generics="TMountedCell extends MountedVirtualCell, TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>"
>
	import { IS_PROD } from "appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey, MountedVirtualCell } from "../types";
	import type { SectionedGridMountedCellSlot } from "../core/reconciliation/mountedSectionedGridRows";
	import {
		KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		resolveVirtualCellBodyKey,
		type VirtualCellBodyLifecyclePolicy,
	} from "ui/virtualization/core/bodyLifecycle";
	import VirtualGridLogicalCellMount from "./VirtualGridLogicalCellMount.svelte";
	import type { VirtualGridSurfaceTransaction } from "./VirtualGridSurfaceTransaction";
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
		bodyLifecyclePolicy?: VirtualCellBodyLifecyclePolicy<TMountedCell>;
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
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
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

	const resolveRowCellSlots = (
		row: TMountedRow,
	): readonly SectionedGridMountedCellSlot<TMountedCell>[] =>
		row.cellSlots ??
		row.cells.map((cell) => ({
			renderSlotIndex: cell.renderSlotIndex,
			columnIndex: cell.columnIndex ?? 0,
			binding: cell,
		}));

	const resolveMountedCellLogicalKey = (cell: TMountedCell): LogicalCellKey =>
		cell.key;

	const resolveMountedCellRowIndex = (cell: TMountedCell): number => cell.rowIndex;

	const resolveMountedCellColumnIndex = (cell: TMountedCell): number | undefined =>
		cell.columnIndex;

	const resolveDefaultMountedCellBodyKey = (cell: TMountedCell): unknown =>
		cell.renderBodyKey ?? cell.cellMetadataKey ?? cell.key;
	const resolveMountedCellBodyKey = (cell: TMountedCell): unknown =>
		bodyLifecyclePolicy.type === "keyed"
			? resolveVirtualCellBodyKey({
					cell,
					policy: bodyLifecyclePolicy,
					resolveDefaultKey: resolveDefaultMountedCellBodyKey,
				})
			: cell.renderSlotIndex;

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
				{#each resolveRowCellSlots(row) as cellSlot (cellSlot.renderSlotIndex)}
					{@const currentBinding = cellSlot.binding}
					<VirtualGridLogicalCellMount
						logicalKey={currentBinding
							? resolveMountedCellLogicalKey(currentBinding)
							: undefined}
						className={currentBinding
							? resolveCellClassName(currentBinding)
							: cellClassName}
						dataTestId={!IS_PROD && currentBinding
							? getCellDataTestId?.(currentBinding)
							: undefined}
						renderSlotIndex={cellSlot.renderSlotIndex}
						rowIndex={currentBinding
							? resolveMountedCellRowIndex(currentBinding)
							: row.rowIndex}
						columnIndex={currentBinding
							? resolveMountedCellColumnIndex(currentBinding)
							: cellSlot.columnIndex}
						ariaHidden={currentBinding === null}
						{surfaceTransaction}
					>
						{#if bodyLifecyclePolicy.type === "keyed"}
							{#if currentBinding}
								{@const mountedCell = currentBinding}
								{#key resolveMountedCellBodyKey(mountedCell)}
									{@render renderCell({
										mountedCell,
										observerRoot,
									})}
								{/key}
							{/if}
						{:else}
							{#key bodyLifecyclePolicy.revision}
								{#if currentBinding}
									{@const mountedCell = currentBinding}
									{@render renderCell({
										mountedCell,
										observerRoot,
									})}
								{/if}
							{/key}
						{/if}
					</VirtualGridLogicalCellMount>
				{/each}
			</div>
		{/if}
	{/each}
</div>
