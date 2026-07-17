<script lang="ts">
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedCellSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type { TwoHopRenderItemCellSnapshot } from "../twoHopCellBinding";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemActivationCandidateId: (cell: TwoHopRenderItemCellSnapshot) => string;
	}

	let {
		cellController,
		getItemActivationCandidateId,
	}: Props = $props();
</script>

<TwoHopItemCellRender
	{cellController}
	{getItemActivationCandidateId}
>
	{#snippet renderItem(item, rowIndex, activationCandidateId)}
		<div data-activation-candidate-id={activationCandidateId}>
			<TwoHopVirtualListSurfaceChildItem {item} {rowIndex} />
		</div>
	{/snippet}
</TwoHopItemCellRender>
