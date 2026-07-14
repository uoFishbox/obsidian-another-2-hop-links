<script lang="ts">
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import type { MountedFlatItemCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
	import TwoHopItemCellRender from "../TwoHopItemCellRender.svelte";
	import type { TwoHopFixedCellSlotController } from "../twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualListSection,
	} from "../twoHopVirtualListModel";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	type TwoHopMountedItemCell = MountedFlatItemCell<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>;

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		initialCell: TwoHopMountedItemCell;
		getItemVisibilityState: (
			cell: TwoHopMountedItemCell,
		) => VirtualizedItemVisibilityState;
		getItemActivationCandidateId: (cell: TwoHopMountedItemCell) => string;
	}

	let {
		cellController,
		initialCell,
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
