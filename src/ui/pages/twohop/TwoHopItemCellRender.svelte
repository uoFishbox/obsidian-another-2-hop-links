<script lang="ts">
	import type { Snippet } from "svelte";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import type { MountedFlatItemCell } from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
	import type { TwoHopFixedCellSlotController } from "./twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualListSection,
	} from "./twoHopVirtualListModel";
	import type { TwoHopCardPresentationState } from "./twoHopCellBinding";
	import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";

	type TwoHopMountedItemCell = MountedFlatItemCell<
		TwoHopVirtualListItem,
		TwoHopVirtualListSection
	>;

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemVisibilityState: (
			cell: TwoHopMountedItemCell,
		) => VirtualizedItemVisibilityState;
		getItemActivationCandidateId: (cell: TwoHopMountedItemCell) => string;
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
		cell: TwoHopFixedCellSlotController["mountedCell"],
	): cell is TwoHopMountedItemCell => cell?.cell.kind === "item";

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
