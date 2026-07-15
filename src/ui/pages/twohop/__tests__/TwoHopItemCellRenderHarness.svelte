<script lang="ts">
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedCellSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		controller: TwoHopFixedCellSlotController;
		visibilityState: VirtualizedItemVisibilityState;
	}

	let { controller, visibilityState }: Props = $props();
</script>

<TwoHopItemCellRender {controller} {visibilityState}>
	{#snippet renderItem(item, rowIndex, visibilityState, activationCandidateId)}
		<div data-activation-candidate-id={activationCandidateId}>
			<TwoHopVirtualListSurfaceChildItem {item} {rowIndex} {visibilityState} />
		</div>
	{/snippet}
</TwoHopItemCellRender>
