<script lang="ts">
	import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
	import TwoHopFixedRowSlotsSurface from "../TwoHopFixedRowSlotsSurface.svelte";
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedRowSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopMountedCell,
		TwoHopMountedItemCell,
	} from "../twoHopMountedTypes";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		rowSlotControllers: readonly TwoHopFixedRowSlotController[];
	}

	let { rowSlotControllers }: Props = $props();
	const cellRegistry = createSurfaceVirtualCellRegistry();
	const isItemCell = (cell: TwoHopMountedCell): cell is TwoHopMountedItemCell =>
		cell.cell.kind === "item";
</script>

<TwoHopFixedRowSlotsSurface
	contentHeight={1_000}
	rowHeight={100}
	columns={2}
	{rowSlotControllers}
	{cellRegistry}
>
	{#snippet renderCell({ mountedCell, cellController, visibilityState })}
		{#if isItemCell(mountedCell)}
			<TwoHopItemCellRender controller={cellController} {visibilityState}>
				{#snippet renderItem(item, rowIndex, visibilityState)}
					<TwoHopVirtualListSurfaceChildItem
						{item}
						{rowIndex}
						{visibilityState}
					/>
				{/snippet}
			</TwoHopItemCellRender>
		{:else}
			<div data-testid={`twohop-${mountedCell.cell.kind}-cell`}>
				{mountedCell.cell.kind}
			</div>
		{/if}
	{/snippet}
</TwoHopFixedRowSlotsSurface>
