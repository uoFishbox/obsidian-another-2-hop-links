<script lang="ts">
	import { IS_PROD } from "appConstants";
	import DelegatedInteractionSurface from "ui/interactions/DelegatedInteractionSurface.svelte";
	import { provideVirtualFrameCoordinator } from "ui/virtualization/svelte/frameCoordinatorContext.svelte";
	import { provideVirtualPreviewSurface } from "features/card-preview/ui/virtualPreviewSurfaceContext";
	import TwoHopProgressiveCell from "features/two-hop/ui/TwoHopProgressiveCell.svelte";
	import {
		useTwoHopProgressiveList,
		type TwoHopProgressiveListProps,
	} from "features/two-hop/ui/useTwoHopProgressiveList.svelte";

	const props: TwoHopProgressiveListProps = $props();
	const frameCoordinator = provideVirtualFrameCoordinator();
	const list = useTwoHopProgressiveList(props, frameCoordinator);
	provideVirtualPreviewSurface(list.previewSurface);
</script>

<DelegatedInteractionSurface
	className="cosense-card-links__section twohop-page-progressive-list twohop-progressive-surface"
	bind:rootEl={list.rootEl}
	bind:contentEl={list.contentEl}
	observerRoot={list.observerRoot}
	rowHeight={list.layout.rowHeight}
	interactionDescriptorScopeId="two-hop-progressive-card-slots"
	interactionDescriptorResolverProvider={list.interactionDescriptorResolverProvider}
	moveFocusWithinList={list.moveFocusWithinList}
>
	{#snippet children()}
		<div
			bind:this={list.contentEl}
			class="view-plan-flow-content twohop-progressive-content"
			style={`
				--twohop-row-height:${list.layout.rowHeight}px;
				--twohop-columns:${list.layout.columns};
				--twohop-gap:${list.layout.gap}px;
			`}
		>
			{#each list.plan.chunks as chunk (chunk.chunkIndex)}
				<div
					class="twohop-progressive-chunk"
					data-ccl-progressive-chunk={!IS_PROD ? chunk.chunkIndex : undefined}
					style={`height:${chunk.height}px;contain-intrinsic-size:auto ${chunk.height}px;`}
				>
					{#each chunk.rows as row (row.rowIndex)}
						{@const previewHostEnabled = list.isPreviewHostEnabled(
							row.rowIndex,
						)}
						<div
							class="twohop-progressive-row"
							data-ccl-progressive-row={row.rowIndex}
							style:top={`${row.top}px`}
						>
							{#each row.cells as cell (cell.logicalKey)}
								<div
									class="twohop-progressive-cell"
									data-ccl-logical-key={cell.logicalKey}
									data-ccl-row-index={cell.rowIndex}
									data-ccl-column-index={cell.columnIndex}
									data-testid={process.env.NODE_ENV !==
										"production" && cell.kind === "item"
										? "twohop-progressive-item-cell"
										: undefined}
								>
									<TwoHopProgressiveCell
										{cell}
										{previewHostEnabled}
										registerCardModelConsumer={list.registerCardModelConsumer}
										onLoadMore={list.loadMore}
									/>
								</div>
							{/each}
						</div>
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
</DelegatedInteractionSurface>
