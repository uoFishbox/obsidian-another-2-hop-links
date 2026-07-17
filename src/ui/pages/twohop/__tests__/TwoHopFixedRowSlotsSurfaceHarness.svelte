<script lang="ts">
	import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
	import TwoHopFixedRowSlotsSurface from "../TwoHopFixedRowSlotsSurface.svelte";
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedRowSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopCellBinding,
		TwoHopItemCellBinding,
	} from "../twoHopCellBinding";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		rowSlotControllers: readonly TwoHopFixedRowSlotController[];
	}

	let { rowSlotControllers }: Props = $props();
	const cellRegistry = createSurfaceVirtualCellRegistry();
	const getItemActivationCandidateId = (cell: { cellSlotKey: number }): string =>
		`candidate:${cell.cellSlotKey}`;
	const isItemCell = (
		binding: TwoHopCellBinding,
	): binding is TwoHopItemCellBinding =>
		binding.compiledCell.logicalCell.kind === "item";
</script>

<TwoHopFixedRowSlotsSurface
	contentHeight={1_000}
	rowHeight={100}
	columns={2}
	{rowSlotControllers}
	{cellRegistry}
>
	{#snippet renderCell({ binding, cellController })}
		{#if isItemCell(binding)}
			<TwoHopItemCellRender
				{cellController}
				{getItemActivationCandidateId}
			>
				{#snippet renderItem(item, rowIndex)}
					<TwoHopVirtualListSurfaceChildItem {item} {rowIndex} />
				{/snippet}
			</TwoHopItemCellRender>
		{:else}
			<div data-testid={`twohop-${binding.compiledCell.logicalCell.kind}-cell`}>
				{binding.compiledCell.logicalCell.kind}
			</div>
		{/if}
	{/snippet}
</TwoHopFixedRowSlotsSurface>
