<script lang="ts">
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedCellSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		controller: TwoHopFixedCellSlotController;
	}

	let { controller }: Props = $props();
</script>

<TwoHopItemCellRender {controller}>
	{#snippet renderItem(item, rowIndex, visibilityState, activationCandidateId)}
		<div data-activation-candidate-id={activationCandidateId}>
			<TwoHopVirtualListSurfaceChildItem {item} {rowIndex} {visibilityState} />
		</div>
	{/snippet}
</TwoHopItemCellRender>
