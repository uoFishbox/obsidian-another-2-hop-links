<script lang="ts">
	import { IS_PROD } from "../../../appConstants";
	import type { Snippet } from "svelte";
	import VirtualGridLogicalCellMount from "ui/components/common/virtual-list/svelte/VirtualGridLogicalCellMount.svelte";
	import type { TwoHopMountedCell } from "./twoHopMountedTypes";
	import type {
		TwoHopFixedCellSlotController,
		TwoHopFixedRowSlotController,
	} from "./twoHopFixedRowSlotPool.svelte";
	import type { VirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";

	interface Props {
		contentClassName?: string;
		rowClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns: number;
		gap?: number;
		rowSlotControllers: readonly TwoHopFixedRowSlotController[];
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		getCellClassName?: (cell: TwoHopMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TwoHopMountedCell) => string | undefined;
		renderCell: Snippet<
			[
				{
					mountedCell: TwoHopMountedCell;
					cellController: TwoHopFixedCellSlotController;
				},
			]
		>;
		cellRegistry: VirtualCellRegistry;
	}

	let {
		contentClassName = "",
		rowClassName = "",
		contentHeight,
		cellWidth,
		rowHeight,
		columns,
		gap,
		rowSlotControllers,
		contentEl = $bindable<HTMLDivElement | null>(null),
		getCellClassName,
		getCellDataTestId,
		renderCell,
		cellRegistry,
	}: Props = $props();

	// Item bodies are owned by the physical slot so scrolling can update their
	// props without recreating the Svelte card tree. Other body kinds retain
	// logical identity keys because their renderers do not implement item rebinds.
	function resolveBodyLifecycleKey(
		controller: TwoHopFixedCellSlotController,
	): string {
		if (controller.renderBodyKind === "item") {
			return "twohop-physical-item-body";
		}

		return `${controller.renderBodyKind}:${controller.renderBodyKey ?? controller.logicalKey}`;
	}

	const contentStyle = $derived(
		`height:${contentHeight}px; position:relative; --ccl-box-height:${rowHeight}px; --ccl-cell-width:${cellWidth ?? 0}px; --ccl-columns:${Math.max(1, Math.floor(columns))}${gap !== undefined ? `; --ccl-box-gap:${gap}px` : ""}`,
	);
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	<div data-ccl-virtual-flow-spacer="top" style:height="0px" aria-hidden="true"></div>
	{#each rowSlotControllers as controller (controller.slotIndex)}
		{#if controller.active}
			<div
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? controller.slotIndex : undefined}
				data-ccl-row-index={!IS_PROD ? controller.rowIndex : undefined}
				style={`position:absolute; left:0; right:0; top:0; transform:translateY(${Math.max(0, controller.top)}px); margin-bottom:0`}
			>
				{#each controller.cells as cellController (cellController.cellSlotKey)}
					{#if cellController.active && cellController.mountedCell}
						{@const mountedCell = cellController.mountedCell}
						<VirtualGridLogicalCellMount
							logicalKey={cellController.logicalKey}
							className={getCellClassName?.(mountedCell) ?? ""}
							dataTestId={getCellDataTestId?.(mountedCell)}
							cellSlotKey={cellController.cellSlotKey}
							rowIndex={cellController.rowIndex}
							columnIndex={cellController.columnIndex}
							{mountedCell}
							{cellRegistry}
							cellRegistrationOwner={cellController}
						>
							{#key resolveBodyLifecycleKey(cellController)}
								{@render renderCell({ mountedCell, cellController })}
							{/key}
						</VirtualGridLogicalCellMount>
					{/if}
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
