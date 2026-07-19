<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { PluginSettings } from "features/settings/model";
	import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: { settings: PluginSettings };
	}

	let { sections, applicationStore }: Props = $props();
</script>

<div class="view-plan-virtual-list">
	{#each sections as descriptor}
		<section data-section-id={descriptor.sectionId}>
			{#each descriptor.getItems() as row}
				<ViewItemCard item={row.item} settings={applicationStore.settings} />
			{/each}
		</section>
	{/each}
</div>
