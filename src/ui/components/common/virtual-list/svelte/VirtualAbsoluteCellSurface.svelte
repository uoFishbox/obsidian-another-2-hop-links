<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import VirtualListCellMount from "./VirtualListCellMount.svelte";
	import type { VirtualSurfaceCellPosition } from "./VirtualSurfaceCells.svelte";

	interface Props<TMountedCell extends MountedVirtualCell> {
		contentClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		mountedCells: readonly TMountedCell[];
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellPosition?: (
			cell: TMountedCell,
		) => VirtualSurfaceCellPosition;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		onCellMount?: (cell: TMountedCell) => void;
		onCellDestroy?: (cell: TMountedCell) => void;
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
		cellClassName = "",
		contentHeight,
		cellWidth = undefined,
		rowHeight,
		mountedCells,
		contentEl = $bindable<HTMLDivElement | null>(null),
		observerRoot = null,
		getCellPosition,
		getCellClassName,
		getCellDataTestId,
		onCellMount,
		onCellDestroy,
		renderCell,
	}: Props<TMountedCell> = $props();

	const resolveCellClassName = (mountedCell: TMountedCell): string => {
		const extraClassName = getCellClassName?.(mountedCell);
		return `${cellClassName} ${extraClassName ?? ""}`.trim();
	};

	const contentStyle = $derived(
		`height:${contentHeight}px; --ccl-box-height:${rowHeight}px`,
	);

	const defaultPosition = $derived({
		top: 0,
		left: 0,
		width: cellWidth ?? 0,
		height: rowHeight,
	});
</script>

<div
	class={contentClassName}
	bind:this={contentEl}
	style={contentStyle}
>
	{#each mountedCells as mountedCell (mountedCell.renderSlotKey)}
		{@const position = getCellPosition?.(mountedCell) ?? defaultPosition}
		<VirtualListCellMount
			logicalKey={mountedCell.key}
			left={position.left}
			top={position.top}
			width={position.width}
			height={position.height}
			className={resolveCellClassName(mountedCell)}
			dataTestId={getCellDataTestId?.(mountedCell)}
			renderSlotKey={mountedCell.renderSlotKey}
			rowIndex={mountedCell.rowIndex}
			columnIndex={mountedCell.columnIndex}
			{mountedCell}
			onMountCell={onCellMount}
			onDestroyCell={onCellDestroy}
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
