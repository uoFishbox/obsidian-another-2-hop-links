<script lang="ts">
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import TwoHopViewPlanVirtualList from "../TwoHopViewPlanVirtualList.svelte";
	import type {
		TwoHopPageVirtualItem,
		TwoHopPageVirtualSection,
	} from "../twohopPageVirtualModel";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";

	interface Props {
		sections: readonly SectionRenderDescriptor<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		>[];
		applicationStore: ApplicationStore;
		getItemInteractionDescriptor?: (
			item: TwoHopPageVirtualItem,
		) => ItemInteractionDescriptor | null;
	}

	let {
		sections,
		applicationStore,
		getItemInteractionDescriptor = () => null,
	}: Props = $props();
</script>

<div
	class="scroll-root"
	data-testid="scroll-root"
	style="overflow: auto; position: relative;"
>
	<TwoHopViewPlanVirtualList
		{sections}
		{applicationStore}
		initialVisibleCount={10_000}
		loadMoreIncrement={10_000}
		{getItemInteractionDescriptor}
	>
		{#snippet renderHeader({ sectionId })}
			<div data-testid="twohop-header-cell">{sectionId}</div>
		{/snippet}

		{#snippet renderItem({ item, index, visibility })}
			<div
				data-testid="twohop-item-cell"
				data-index={index}
				data-visibility={visibility}
				data-ccl-interaction-id={item.interactionId}
				data-ccl-interaction-kind="item"
			>
				Item {index}
			</div>
		{/snippet}
	</TwoHopViewPlanVirtualList>
</div>
