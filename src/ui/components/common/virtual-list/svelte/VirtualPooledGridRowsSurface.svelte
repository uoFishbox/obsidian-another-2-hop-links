<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import { IS_PROD } from "../../../../../appConstants";
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import type { RowKey } from "../rowKey";
	import VirtualListCellMount from "./VirtualListCellMount.svelte";
	import type {
		VirtualSurfaceCellPosition,
		VirtualSurfaceMountedRow,
	} from "./VirtualSurfaceCells.svelte";

	interface VirtualSurfaceRow<TMountedCell extends MountedVirtualCell> {
		key: RowKey;
		rowIndex: number;
		top: number;
		slotIndex?: number;
		slotKey?: number;
		attributes?: Record<string, string | number | undefined>;
		cells: TMountedCell[];
	}

	interface Props<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		mountedCells: readonly TMountedCell[];
		mountedRows?: readonly VirtualSurfaceMountedRow<TMountedCell>[];
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellPosition?: (cell: TMountedCell) => VirtualSurfaceCellPosition;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		getRowRenderKey?: (rowIndex: number) => RowKey | undefined;
		getRowDataAttributes?: (
			rowIndex: number,
		) => Record<string, string | number | undefined> | undefined;
		onLogicalCellAttach?: (cell: TMountedCell) => void;
		onLogicalCellDetach?: (cell: TMountedCell) => void;
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
		mountedCells,
		mountedRows: directMountedRows = undefined,
		contentEl = $bindable<HTMLDivElement | null>(null),
		observerRoot = null,
		getCellPosition,
		getCellClassName,
		getCellDataTestId,
		getRowRenderKey,
		getRowDataAttributes,
		onLogicalCellAttach,
		onLogicalCellDetach,
		renderCell,
	}: Props<TMountedCell> = $props();

	const resolveCellClassName = (mountedCell: TMountedCell): string => {
		const extraClassName = getCellClassName?.(mountedCell);
		return `${cellClassName} ${extraClassName ?? ""}`.trim();
	};

	const mountedRows = $derived.by(() => {
		const rowsByIndex = new Map<number, VirtualSurfaceRow<TMountedCell>>();
		const rows: VirtualSurfaceRow<TMountedCell>[] = [];

		if (!getCellPosition) {
			return rows;
		}

		for (const mountedCell of mountedCells) {
			const position = getCellPosition(mountedCell);
			const rowIndex = mountedCell.rowIndex;
			let row = rowsByIndex.get(rowIndex);
			if (!row) {
				row = {
					key: getRowRenderKey?.(rowIndex) ?? rowIndex,
					rowIndex,
					top: position.top,
					attributes: getRowDataAttributes?.(rowIndex),
					cells: [],
				};
				rowsByIndex.set(rowIndex, row);
				rows.push(row);
			} else {
				const nextTop = Math.min(row.top, position.top);
				if (nextTop !== row.top) {
					row.top = nextTop;
				}
			}
			row.cells.push(mountedCell);
		}

		return rows;
	});

	const renderedRows = $derived(directMountedRows ?? mountedRows);

	const contentStyle = $derived(
		`height:${contentHeight}px; position:relative; --ccl-box-height:${rowHeight}px; --ccl-cell-width:${cellWidth ?? 0}px; --ccl-columns:${Math.max(1, Math.floor(columns))}${gap !== undefined ? `; --ccl-box-gap:${gap}px` : ""}`,
	);

	const resolveRowSlotKey = (row: VirtualSurfaceMountedRow<TMountedCell>): number =>
		row.slotKey ?? row.key;
	const resolveCellSlotKey = (
		_row: VirtualSurfaceMountedRow<TMountedCell>,
		cell: TMountedCell,
	): number => cell.cellSlotKey ?? cell.renderSlotIndex;
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	{#each renderedRows as row (resolveRowSlotKey(row))}
		<div
			class={rowClassName}
			data-ccl-row-slot={!IS_PROD ? row.slotIndex : undefined}
			data-ccl-row-index={!IS_PROD ? row.rowIndex : undefined}
			style:transform={`translateY(${row.top}px)`}
			{...row.attributes}
		>
			{#each row.cells as mountedCell (resolveCellSlotKey(row, mountedCell))}
				<VirtualListCellMount
					logicalKey={mountedCell.key}
					className={resolveCellClassName(mountedCell)}
					dataTestId={getCellDataTestId?.(mountedCell)}
					cellSlotKey={resolveCellSlotKey(row, mountedCell)}
					rowIndex={mountedCell.rowIndex}
					columnIndex={mountedCell.columnIndex}
					{mountedCell}
					lifecycleMode="logical"
					onMountCell={onLogicalCellAttach}
					onDestroyCell={onLogicalCellDetach}
				>
					{#key mountedCell.renderBodyKey ?? mountedCell.cellMetadataKey ?? mountedCell.key}
						{@render renderCell({
							mountedCell,
							observerRoot,
						})}
					{/key}
				</VirtualListCellMount>
			{/each}
		</div>
	{/each}
</div>
