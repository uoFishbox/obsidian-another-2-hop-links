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
		initialCell,
		getItemVisibilityState,
		getItemActivationCandidateId,
		renderItem,
	}: Props = $props();

	const isItemCell = (
		cell: TwoHopFixedCellSlotController["mountedCell"],
	): cell is TwoHopMountedItemCell => cell?.cell.kind === "item";

	// Keep an immutable fallback because the scalar kernel mutates the physical
	// cell shell before the parent keyed block can unmount this item body.
	const fallbackItemCell: TwoHopMountedItemCell = {
		...initialCell,
		cell: { ...initialCell.cell },
	};

	// Recompute this object once for each physical-slot reassignment. Consumers
	// then read ordinary reactive snapshot fields instead of traversing the slot
	// controller and resolving visibility on every individual prop access.
	const snapshot = $derived.by(() => {
		const binding = cellController.binding;
		const mountedCell = binding?.mountedCell;
		const itemCell = isItemCell(mountedCell) ? mountedCell : fallbackItemCell;
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

{@render renderItem(
	snapshot.item,
	snapshot.rowIndex,
	snapshot.visibilityState,
	snapshot.activationCandidateId,
	snapshot.presentation,
)}
