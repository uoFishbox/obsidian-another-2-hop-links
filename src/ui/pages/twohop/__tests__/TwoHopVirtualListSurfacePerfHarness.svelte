<script lang="ts">
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import TwoHopViewPlanVirtualList from "../TwoHopVirtualListSurface.svelte";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualListSection,
	} from "../twoHopVirtualListModel";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";

	interface Props {
		sections: readonly SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>[];
		applicationStore: ApplicationStore;
		getItemInteractionDescriptor?: (
			item: TwoHopVirtualListItem,
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

		{#snippet renderItem(item, rowIndex, visibilityState)}
			<div
				data-testid="twohop-item-cell"
				data-index={item.virtualKey}
				data-visibility={visibilityState.visibility}
				data-ccl-interaction-id={item.interactionId}
				data-ccl-interaction-kind="item"
			>
				Item {rowIndex}
			</div>
		{/snippet}
	</TwoHopViewPlanVirtualList>
</div>
