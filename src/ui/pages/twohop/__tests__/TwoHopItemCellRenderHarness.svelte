<script lang="ts">
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedCellSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type { TwoHopRenderItemCellSnapshot } from "../twoHopCellBinding";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemVisibilityState: (
			cell: TwoHopRenderItemCellSnapshot,
		) => VirtualizedItemVisibilityState;
		getItemActivationCandidateId: (cell: TwoHopRenderItemCellSnapshot) => string;
	}

	let {
		cellController,
		getItemVisibilityState,
		getItemActivationCandidateId,
	}: Props = $props();
</script>

<TwoHopItemCellRender
	{cellController}
	{getItemVisibilityState}
	{getItemActivationCandidateId}
>
	{#snippet renderItem(item, rowIndex, visibilityState, activationCandidateId)}
		<div data-activation-candidate-id={activationCandidateId}>
			<TwoHopVirtualListSurfaceChildItem {item} {rowIndex} {visibilityState} />
		</div>
	{/snippet}
</TwoHopItemCellRender>
