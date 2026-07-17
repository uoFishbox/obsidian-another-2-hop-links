<script lang="ts">
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import TwoHopViewPlanVirtualList from "../TwoHopVirtualListSurface.svelte";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualListSection,
	} from "../twoHopVirtualListModel";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
	import TwoHopVirtualListSurfaceChildItem from "./TwoHopVirtualListSurfaceChildItem.svelte";

	interface Props {
		sections: readonly SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>[];
		applicationStore: ApplicationStore;
		getItemInteractionDescriptor?: (
			item: TwoHopVirtualListItem,
		) => ItemInteractionDescriptor | null;
		interactionDescriptorRevision?: unknown;
		renderChildComponent?: boolean;
	}

	let {
		sections,
		applicationStore,
		getItemInteractionDescriptor = () => null,
		interactionDescriptorRevision,
		renderChildComponent = false,
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
		{interactionDescriptorRevision}
	>
		{#snippet renderHeader({ sectionId })}
			<div data-testid="twohop-header-cell">{sectionId}</div>
		{/snippet}

		{#snippet renderItem(item, rowIndex)}
			{#if renderChildComponent}
				<TwoHopVirtualListSurfaceChildItem {item} {rowIndex} />
			{:else}
				<div
					data-testid="twohop-item-cell"
					data-index={item.virtualKey}
					data-ccl-interaction-id={item.interactionId}
					data-ccl-interaction-kind="item"
				>
					Item {rowIndex}
				</div>
			{/if}
		{/snippet}
	</TwoHopViewPlanVirtualList>
</div>
