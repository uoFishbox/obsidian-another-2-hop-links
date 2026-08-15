<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/useTwoHopVirtualList.svelte";
	import { captureTwoHopVirtualSurfacePageStubProps } from "./twoHopVirtualSurfacePageStubCapture";

	interface Props {
		sections: readonly TwoHopSectionModel[];
		applicationStore: ApplicationStore;
		loadMoreSection?: (sectionId: string) => void;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
	}

	let {
		sections,
		applicationStore,
		loadMoreSection,
		previewDependencies = undefined,
		previewActive = true,
	}: Props = $props();

	$effect(() => {
		captureTwoHopVirtualSurfacePageStubProps({
			applicationStore,
			loadMoreSection,
			previewDependencies,
			previewActive,
		});
	});
</script>

<div
	class="twohop-page-virtual-list"
	data-testid="two-hop-virtual-surface-stub"
	data-has-preview-dependencies={String(previewDependencies !== undefined)}
	data-has-preview-runtime={String(
		typeof previewDependencies?.previewRuntime?.createSurface === "function",
	)}
	data-has-search-position-resolver={String(
		typeof previewDependencies?.resolveSearchMatchPosition === "function",
	)}
	data-preview-active={String(previewActive)}
>
	{#each sections as section}
		<section data-section-id={section.id}>
			{#each section.items as row}
				<ViewItemCard item={row.item} settings={applicationStore.settings} />
			{/each}
		</section>
	{/each}
</div>
