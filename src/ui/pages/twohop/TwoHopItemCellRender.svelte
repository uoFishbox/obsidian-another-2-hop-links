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
		controller: TwoHopFixedCellSlotController;
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

	let { controller, renderItem }: Props = $props();

	const isItemCell = (
		cell: TwoHopFixedCellSlotController["mountedCell"],
	): cell is TwoHopMountedItemCell => cell?.cell.kind === "item";

	const initialCell = controller.mountedCell;
	// The parent normally unmounts this body when its slot changes kind. Keep the
	// last item shell valid during that keyed-block transition.
	const fallbackItemCell: TwoHopMountedItemCell | null = isItemCell(initialCell)
		? {
				...initialCell,
				cell: { ...initialCell.cell },
			}
		: null;
	const fallbackPresentation: TwoHopCardPresentationState = {
		sectionVariant: "two-hop",
		resolution: "resolved",
		attachment: false,
		extension: null,
	};
	const item = $derived.by(() => {
		void controller.revision;
		const binding = controller.binding;
		const mountedCell = binding?.mountedCell;
		return isItemCell(mountedCell)
			? mountedCell.cell.item
			: fallbackItemCell?.cell.item;
	});
	const rowIndex = $derived.by(() => {
		void controller.revision;
		const binding = controller.binding;
		const mountedCell = binding?.mountedCell;
		return isItemCell(mountedCell)
			? mountedCell.rowIndex
			: fallbackItemCell?.rowIndex;
	});
	const presentation = $derived.by(() => {
		void controller.revision;
		return controller.binding?.presentation ?? fallbackPresentation;
	});
</script>

{#if item && rowIndex !== undefined}
	{@render renderItem(
		item,
		rowIndex,
		controller.visibilityState,
		controller.activationCandidateId,
		presentation,
	)}
{/if}
