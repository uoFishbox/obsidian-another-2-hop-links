<script lang="ts">
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedCellSlotController } from "../twoHopPhysicalSlotStore.svelte";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemActivationCandidateId: (cell: TwoHopFixedCellSlotController) => string;
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
