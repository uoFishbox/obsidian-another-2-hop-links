<script
	lang="ts"
	generics="TMountedCell extends MountedVirtualCell, TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>"
>
	import { IS_PROD } from "appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey, MountedVirtualCell } from "../types";
	import { renderSlotKey } from "../types";
	import type { SectionedGridMountedCellSlot } from "../core/reconciliation/mountedSectionedGridRows";
	import {
		KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		resolveVirtualCellBodyKey,
		type VirtualCellBodyLifecyclePolicy,
	} from "ui/virtualization/core/bodyLifecycle";
	import VirtualGridLogicalCellMount from "./VirtualGridLogicalCellMount.svelte";
	import type {
		VirtualCellRegistrationOwner,
		VirtualCellRegistry,
	} from "./VirtualCellRegistry";
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
		onLogicalCellAttach?: (cell: TMountedCell) => void;
		onLogicalCellDetach?: (cell: TMountedCell) => void;
		bodyLifecyclePolicy?: VirtualCellBodyLifecyclePolicy<TMountedCell>;
		isRowActive?: (row: TMountedRow) => boolean;
		cellRegistry?: VirtualCellRegistry;
		getCellRegistrationOwner?: (
			cell: TMountedCell,
		) => VirtualCellRegistrationOwner | undefined;
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
		onLogicalCellAttach,
		onLogicalCellDetach,
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		isRowActive,
		cellRegistry,
		getCellRegistrationOwner,
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

	const resolveCellSlotKey = (_row: TMountedRow, cell: TMountedCell): number =>
		cell.cellSlotKey ?? cell.renderSlotIndex;

	const resolveRowCellSlots = (
		row: TMountedRow,
	): readonly SectionedGridMountedCellSlot<TMountedCell>[] =>
		row.cellSlots ??
		row.cells.map((cell) => ({
			renderSlotIndex: cell.renderSlotIndex,
			renderSlotKey: renderSlotKey(cell.renderSlotIndex),
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
			: cell.renderSlotKey;

	const setRowTransform = (element: HTMLElement, top: number) => {
		let committedTop = Number.NaN;

		const update = (nextTop: number): void => {
			const normalizedTop = Math.max(0, nextTop);
			if (normalizedTop === committedTop) return;

			committedTop = normalizedTop;
			element.style.transform = `translateY(${normalizedTop}px)`;
		};
		update(top);
		return { update };
	};
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	<div data-ccl-virtual-flow-spacer="top" style:height="0px" aria-hidden="true"></div>
	{#each mountedRows as row (row.slotIndex ?? row.key)}
		{#if !isRowActive || isRowActive(row)}
			<div
				{...row.attributes}
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
				data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
				use:setRowTransform={row.top}
			>
				{#each resolveRowCellSlots(row) as cellSlot (cellSlot.renderSlotKey)}
					{@const mountedCell = cellSlot.binding}
					<VirtualGridLogicalCellMount
						logicalKey={mountedCell
							? resolveMountedCellLogicalKey(mountedCell)
							: undefined}
						className={mountedCell
							? resolveCellClassName(mountedCell)
							: cellClassName}
						dataTestId={!IS_PROD && mountedCell
							? getCellDataTestId?.(mountedCell)
							: undefined}
						cellSlotKey={mountedCell
							? resolveCellSlotKey(row, mountedCell)
							: cellSlot.renderSlotIndex}
						rowIndex={mountedCell
							? resolveMountedCellRowIndex(mountedCell)
							: row.rowIndex}
						columnIndex={mountedCell
							? resolveMountedCellColumnIndex(mountedCell)
							: cellSlot.columnIndex}
						ariaHidden={mountedCell === null}
						mountedCell={mountedCell ?? undefined}
						{onLogicalCellAttach}
						{onLogicalCellDetach}
						{cellRegistry}
						cellRegistrationOwner={mountedCell
							? getCellRegistrationOwner?.(mountedCell)
							: undefined}
						{surfaceTransaction}
					>
						{#if mountedCell}
							{#if bodyLifecyclePolicy.type === "keyed"}
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
						{/if}
					</VirtualGridLogicalCellMount>
				{/each}
			</div>
		{/if}
	{/each}
	<div
		data-ccl-virtual-flow-spacer="bottom"
		style:height="0px"
		aria-hidden="true"
	></div>
</div>
