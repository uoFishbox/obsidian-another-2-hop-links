<script lang="ts">
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
	import TwoHopFixedRowSlotsSurface from "../TwoHopFixedRowSlotsSurface.svelte";
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedRowSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopRenderCellSnapshot,
		TwoHopRenderItemCellSnapshot,
	} from "../twoHopCellBinding";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		rowSlotControllers: readonly TwoHopFixedRowSlotController[];
	}

	let { rowSlotControllers }: Props = $props();
	const cellRegistry = createSurfaceVirtualCellRegistry();
	const getItemVisibilityState = (
		_cell: TwoHopRenderItemCellSnapshot,
	): VirtualizedItemVisibilityState => ({ visibility: "mounted" });
	const getItemActivationCandidateId = (cell: TwoHopRenderItemCellSnapshot): string =>
		`candidate:${cell.cell.item.virtualKey}`;
	const isItemCell = (
		cell: TwoHopRenderCellSnapshot,
	): cell is TwoHopRenderItemCellSnapshot => cell.cell.kind === "item";
</script>

<TwoHopFixedRowSlotsSurface
	contentHeight={1_000}
	rowHeight={100}
	columns={2}
	{rowSlotControllers}
	{cellRegistry}
>
	{#snippet renderCell({ mountedCell, cellController })}
		{#if isItemCell(mountedCell)}
			<TwoHopItemCellRender
				{cellController}
				{getItemVisibilityState}
				{getItemActivationCandidateId}
			>
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
