<script lang="ts">
	import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
	import VirtualPooledGridRowsSurface from "ui/components/common/virtual-list/svelte/VirtualPooledGridRowsSurface.svelte";
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedRowSlotController } from "../twoHopPhysicalSlotStore.svelte";
	import type {
		TwoHopCellBinding,
		TwoHopItemCellBinding,
	} from "../twoHopCellBinding";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";
	import { TWO_HOP_BODY_LIFECYCLE_POLICY } from "../twoHopBodyLifecycle";

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
	const isActiveRow = (row: TwoHopFixedRowSlotController): boolean => row.active;
</script>

<VirtualPooledGridRowsSurface
	contentHeight={1_000}
	rowHeight={100}
	columns={2}
	mountedRows={rowSlotControllers}
	cellClassName="view-plan-virtual-list-cell view-plan-flow-cell"
	isRowActive={isActiveRow}
	bodyLifecyclePolicy={TWO_HOP_BODY_LIFECYCLE_POLICY}
	{cellRegistry}
	getCellRegistrationOwner={(cell) => cell}
>
	{#snippet renderCell({ mountedCell: cellController })}
		{#if cellController.binding}
			{@const binding = cellController.binding}
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
		{/if}
	{/snippet}
</VirtualPooledGridRowsSurface>
