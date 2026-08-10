<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/useTwoHopVirtualList.svelte";
	import { captureTwoHopVirtualSurfacePageStubProps } from "./twoHopVirtualSurfacePageStubCapture";

	interface Props {
		documentIdentity: string;
		sections: readonly TwoHopSectionModel[];
		applicationStore: ApplicationStore;
		loadMoreSection?: (sectionId: string) => void;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
		offscreenBootstrapPreviewRows?: number;
	}

	let {
		documentIdentity,
		sections,
		applicationStore,
		loadMoreSection,
		previewDependencies = undefined,
		previewActive = true,
		offscreenBootstrapPreviewRows = 0,
	}: Props = $props();

	$effect(() => {
		captureTwoHopVirtualSurfacePageStubProps({
			documentIdentity,
			applicationStore,
			loadMoreSection,
			previewDependencies,
			previewActive,
			offscreenBootstrapPreviewRows,
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
	data-offscreen-bootstrap-preview-rows={String(offscreenBootstrapPreviewRows)}
>
	{#each sections as section}
		<section data-section-id={section.id}>
			{#each section.items as row}
				<ViewItemCard item={row.item} settings={applicationStore.settings} />
			{/each}
		</section>
	{/each}
</div>
