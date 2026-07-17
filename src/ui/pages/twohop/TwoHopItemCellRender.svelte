<script lang="ts">
	import type { Snippet } from "svelte";
	import type { TwoHopFixedCellSlotController } from "./twoHopFixedRowSlotPool.svelte";
	import type {
		TwoHopCardPresentationState,
		TwoHopRenderCellSnapshot,
		TwoHopRenderItemCellSnapshot,
	} from "./twoHopCellBinding";
	import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";
	import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemActivationCandidateId: (cell: TwoHopRenderItemCellSnapshot) => string;
		renderItem: Snippet<
			[
				TwoHopVirtualListItem,
				number,
				string,
				TwoHopCardPresentationState,
				CardRenderModel | null,
			]
		>;
	}

	let { cellController, getItemActivationCandidateId, renderItem }: Props = $props();
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
			activationCandidateId: getItemActivationCandidateId(itemCell),
			presentation: presentation ?? {
				sectionVariant: "two-hop" as const,
				resolution: "resolved" as const,
				attachment: false,
				extension: null,
			},
			cardModel: itemCell.compiledCell?.cardModel ?? null,
		};
	});
</script>

{#if snapshot}
	{@render renderItem(
		snapshot.item,
		snapshot.rowIndex,
		snapshot.activationCandidateId,
		snapshot.presentation,
		snapshot.cardModel,
	)}
{/if}
