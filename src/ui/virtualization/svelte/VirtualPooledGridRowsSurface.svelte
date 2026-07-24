<script
	lang="ts"
	generics="TMountedCell extends MountedVirtualCell, TMountedRow extends VirtualSurfaceMountedRow<TMountedCell>"
>
	import { IS_PROD } from "appConstants";
	import type { Snippet } from "svelte";
	import type { LogicalCellKey, MountedVirtualCell } from "../types";
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
	import type {
		VirtualSurfaceMountedRow,
		VirtualSurfaceResidentRowViewState,
	} from "./VirtualSurfaceTypes";

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
		mountedRows?: readonly TMountedRow[];
		residentRows?: readonly VirtualSurfaceResidentRowViewState<TMountedCell>[];
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
		mountedRows = undefined,
		residentRows = undefined,
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
		const update = (nextTop: number): void => {
			element.style.transform = `translateY(${Math.max(0, nextTop)}px)`;
		};
		update(top);
		return { update };
	};

	const directRowViewStates = $derived(
		(mountedRows ?? []).map((row) => ({
			slotIndex: row.slotIndex ?? row.key,
			row,
		})),
	);
	const rowViewStates = $derived(residentRows ?? directRowViewStates);
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	<div data-ccl-virtual-flow-spacer="top" style:height="0px" aria-hidden="true"></div>
	{#each rowViewStates as rowViewState (rowViewState.slotIndex)}
		{@const row = rowViewState.row as TMountedRow | undefined}
		{#if row && (!isRowActive || isRowActive(row))}
			<div
				{...row.attributes}
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
				data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
				use:setRowTransform={row.top}
			>
				{#each row.cells as mountedCell (resolveCellSlotKey(row, mountedCell))}
					<VirtualGridLogicalCellMount
						logicalKey={resolveMountedCellLogicalKey(mountedCell)}
						className={resolveCellClassName(mountedCell)}
						dataTestId={!IS_PROD
							? getCellDataTestId?.(mountedCell)
							: undefined}
						cellSlotKey={resolveCellSlotKey(row, mountedCell)}
						rowIndex={resolveMountedCellRowIndex(mountedCell)}
						columnIndex={resolveMountedCellColumnIndex(mountedCell)}
						{mountedCell}
						{onLogicalCellAttach}
						{onLogicalCellDetach}
						{cellRegistry}
						cellRegistrationOwner={getCellRegistrationOwner?.(mountedCell)}
					>
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
