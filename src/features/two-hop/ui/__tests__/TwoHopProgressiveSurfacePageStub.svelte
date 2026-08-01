<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { TwoHopVirtualSectionDescriptor } from "features/two-hop/ui/twoHopVirtualListModel";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
	import { captureTwoHopProgressiveSurfacePageStubProps } from "./twoHopProgressiveSurfacePageStubCapture";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
	}

	let {
		sections,
		applicationStore,
		previewDependencies = undefined,
		previewActive = true,
	}: Props = $props();

	$effect(() => {
		captureTwoHopProgressiveSurfacePageStubProps({
			applicationStore,
			previewDependencies,
			previewActive,
		});
	});
</script>

<div
	class="twohop-page-progressive-list"
	data-testid="two-hop-progressive-surface-stub"
	data-has-preview-dependencies={String(previewDependencies !== undefined)}
	data-has-preview-runtime={String(
		typeof previewDependencies?.previewRuntime?.createSurface === "function",
	)}
	data-has-search-position-resolver={String(
		typeof previewDependencies?.resolveSearchMatchPosition === "function",
	)}
	data-preview-active={String(previewActive)}
>
	{#each sections as descriptor}
		<section data-section-id={descriptor.sectionId}>
			{#each descriptor.getItems() as row}
				<ViewItemCard item={row.item} settings={applicationStore.settings} />
			{/each}
		</section>
	{/each}
</div>
