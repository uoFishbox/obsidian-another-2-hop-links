<script lang="ts">
	import type { Snippet } from "svelte";
	import type { TwoHopFixedCellSlotController } from "./twoHopPhysicalSlotStore.svelte";
	import type {
		TwoHopCardPresentationState,
		TwoHopItemCellBinding,
	} from "./twoHopCellBinding";
	import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";
	import { recordCCLDevMeasurement } from "infrastructure/debug/CCLDevMeasurements";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";

	interface Props {
		cellController: TwoHopFixedCellSlotController;
		getItemActivationCandidateId: (
			cell: TwoHopFixedCellSlotController,
		) => string;
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

	const isItemBinding = (
		binding: TwoHopFixedCellSlotController["binding"],
	): binding is TwoHopItemCellBinding =>
		binding?.compiledCell.logicalCell.kind === "item";

	// Recompute this object once for each physical-slot reassignment. Consumers
	// then read ordinary reactive snapshot fields instead of traversing the slot
	// controller and resolving visibility on every individual prop access.
	const snapshot = $derived.by(() => {
		const binding = cellController.binding;
		if (!isItemBinding(binding)) return null;
		const compiledCell = binding.compiledCell;
		const presentation = compiledCell.presentation;
		return {
			item: compiledCell.logicalCell.item,
			rowIndex: binding.logicalRowIndex,
			activationCandidateId: getItemActivationCandidateId(cellController),
			presentation: presentation ?? {
				sectionVariant: "two-hop" as const,
				resolution: "resolved" as const,
				attachment: false,
				extension: null,
			},
			cardModel: compiledCell.cardModel,
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
