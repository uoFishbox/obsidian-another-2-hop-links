<script lang="ts">
	import VirtualInteractiveSurface from "ui/virtualization/svelte/VirtualInteractiveSurface.svelte";
	import { provideVirtualFrameCoordinator } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import { provideVirtualPreviewSurface } from "features/preview/ui/virtualPreviewSurfaceContext";
	import TwoHopProgressiveRow from "features/two-hop/ui/TwoHopProgressiveRow.svelte";
	import {
		useTwoHopProgressiveList,
		type TwoHopProgressiveListProps,
	} from "features/two-hop/ui/useTwoHopProgressiveList.svelte";

	const props: TwoHopProgressiveListProps = $props();
	const frameCoordinator = provideVirtualFrameCoordinator();
	const list = useTwoHopProgressiveList(props, frameCoordinator);
	provideVirtualPreviewSurface(list.previewSurface);
</script>

<VirtualInteractiveSurface
	className="cosense-card-links__section twohop-page-progressive-list twohop-progressive-surface"
	bind:rootEl={list.rootEl}
	bind:contentEl={list.contentEl}
	observerRoot={list.observerRoot}
	rowHeight={list.layout.rowHeight}
	interactionDescriptorScopeId="two-hop-progressive-card-slots"
	interactionDescriptorResolverProvider={list.interactionDescriptorResolverProvider}
>
	{#snippet children()}
		<div
			bind:this={list.contentEl}
			class="view-plan-flow-content twohop-progressive-content"
		>
			{#each list.plan.chunks as chunk (chunk.key)}
				<div
					class="twohop-progressive-chunk"
					data-ccl-progressive-chunk={chunk.chunkIndex}
					style={`height:${chunk.height}px;contain-intrinsic-size:auto ${chunk.height}px;`}
				>
					{#each chunk.rows as row (row.key)}
						<TwoHopProgressiveRow
							{row}
							layout={list.layout}
							registerCardModelConsumer={list.registerCardModelConsumer}
							registerPreviewRow={list.registerPreviewRow}
							onLoadMore={list.loadMore}
						/>
					{/each}
				</div>
			{/each}
			{#if list.plan.hasMoreRows}
				<div
					bind:this={list.sentinelEl}
					class="twohop-progressive-sentinel"
					aria-hidden="true"
				></div>
			{/if}
		</div>
	{/snippet}
</VirtualInteractiveSurface>
