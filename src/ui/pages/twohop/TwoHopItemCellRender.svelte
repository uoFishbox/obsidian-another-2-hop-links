<script lang="ts">
	import type { Snippet } from "svelte";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import type { TwoHopFixedCellSlotController } from "./twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopCardPresentationState,
		TwoHopRenderCellSnapshot,
		TwoHopRenderItemCellSnapshot,
	} from "./twoHopCellBinding";
	import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";
	import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemVisibilityState: (
			cell: TwoHopRenderItemCellSnapshot,
		) => VirtualizedItemVisibilityState;
		getItemActivationCandidateId: (cell: TwoHopRenderItemCellSnapshot) => string;
		renderItem: Snippet<
			[
				TwoHopVirtualListItem,
				number,
				VirtualizedItemVisibilityState,
				string,
				TwoHopCardPresentationState,
			]
		>;
	}

	let {
		cellController,
		getItemVisibilityState,
		getItemActivationCandidateId,
		renderItem,
	}: Props = $props();
	if (process.env.NODE_ENV !== "production") {
		recordCCLDevMeasurement("twoHop.itemBody.mount");
	}

	const isItemCell = (
		cell: TwoHopRenderCellSnapshot | undefined,
	): cell is TwoHopRenderItemCellSnapshot => cell?.cell.kind === "item";

	// Recompute this object once for each physical-slot reassignment. Consumers
	// then read ordinary reactive snapshot fields instead of traversing the slot
	// controller and resolving visibility on every individual prop access.
	const snapshot = $derived.by(() => {
		const binding = cellController.binding;
		const mountedCell = binding?.mountedCell;
		if (!isItemCell(mountedCell)) return null;
		const itemCell = mountedCell;
		const presentation = binding?.presentation;
		return {
			item: itemCell.cell.item,
			rowIndex: itemCell.rowIndex,
			visibilityState: getItemVisibilityState(itemCell),
			activationCandidateId: getItemActivationCandidateId(itemCell),
			presentation: presentation ?? {
				sectionVariant: "two-hop" as const,
				resolution: "resolved" as const,
				attachment: false,
				extension: null,
			},
		};
	});
</script>

{#if snapshot}
	{@render renderItem(
		snapshot.item,
		snapshot.rowIndex,
		snapshot.visibilityState,
		snapshot.activationCandidateId,
		snapshot.presentation,
	)}
{/if}
