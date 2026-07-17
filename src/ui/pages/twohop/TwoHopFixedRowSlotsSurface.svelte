<script lang="ts">
	import { IS_PROD } from "../../../appConstants";
	import type { Snippet } from "svelte";
	import VirtualGridLogicalCellMount from "ui/components/common/virtual-list/svelte/VirtualGridLogicalCellMount.svelte";
	import type {
		TwoHopCellBinding,
		TwoHopRowSlotFrame,
	} from "./twoHopCellBinding";
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
		getCellDataTestId?: (binding: TwoHopCellBinding) => string | undefined;
		renderCell: Snippet<
			[
				{
					binding: TwoHopCellBinding;
					rowFrame: TwoHopRowSlotFrame;
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
		getCellDataTestId,
		renderCell,
		cellRegistry,
	}: Props = $props();

	// Item bodies are owned by the physical slot so scrolling can update their
	// props without recreating the Svelte card tree. Other body kinds retain
	// logical identity keys because their renderers do not implement item rebinds.
	function resolveBodyLifecycleKey(binding: TwoHopCellBinding): string {
		const compiledCell = binding.compiledCell;
		if (compiledCell.renderBodyKind === "item") {
			return `twohop-item:${compiledCell.reuseFamily ?? "resolved-card"}`;
		}

		return `${compiledCell.renderBodyKind}:${compiledCell.renderBodyKey ?? compiledCell.logicalKey}`;
	}

	const contentStyle = $derived(
		`height:${contentHeight}px; position:relative; --ccl-box-height:${rowHeight}px; --ccl-cell-width:${cellWidth ?? 0}px; --ccl-columns:${Math.max(1, Math.floor(columns))}${gap !== undefined ? `; --ccl-box-gap:${gap}px` : ""}`,
	);
</script>

<div class={contentClassName} bind:this={contentEl} style={contentStyle}>
	<div data-ccl-virtual-flow-spacer="top" style:height="0px" aria-hidden="true"></div>
	{#each rowSlotControllers as controller (controller.slotIndex)}
		{#if controller.frame}
			{@const rowFrame = controller.frame}
			<div
				class={rowClassName}
				data-ccl-row-slot={!IS_PROD ? controller.slotIndex : undefined}
				data-ccl-row-index={!IS_PROD ? controller.rowIndex : undefined}
				style={`position:absolute; left:0; right:0; top:0; transform:translateY(${Math.max(0, controller.top)}px); margin-bottom:0`}
			>
				{#each controller.cellControllers as cellController (cellController.cellSlotKey)}
					{#if cellController.active && cellController.binding}
						{@const binding = cellController.binding}
						<VirtualGridLogicalCellMount
							logicalKey={binding.compiledCell.logicalKey}
							className="view-plan-virtual-list-cell view-plan-flow-cell"
							dataTestId={getCellDataTestId?.(binding)}
							cellSlotKey={cellController.cellSlotKey}
							rowIndex={cellController.rowIndex}
							columnIndex={cellController.columnIndex}
							{cellRegistry}
							cellRegistrationOwner={cellController}
						>
							{#key resolveBodyLifecycleKey(binding)}
								{@render renderCell({ binding, rowFrame, cellController })}
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
