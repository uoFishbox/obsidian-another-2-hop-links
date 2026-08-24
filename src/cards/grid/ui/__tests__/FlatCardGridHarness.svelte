<script lang="ts">
	import FlatCardGrid from "../FlatCardGrid.svelte";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";

	interface Props {
		items: string[];
		showHeader?: boolean;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		sectionId?: string;
		applicationStore?: CardCollectionState;
		paginationMode?: "button" | "infinite-scroll";
		infiniteScrollRootMargin?: string;
		topSpacerHeight?: number;
	}

	let {
		items,
		showHeader = false,
		initialVisibleCount = items.length,
		loadMoreIncrement = items.length,
		sectionId,
		applicationStore,
		paginationMode = "button",
		infiniteScrollRootMargin = "0px 0px 900px 0px",
		topSpacerHeight = 0,
	}: Props = $props();
</script>

<div
	class="scroll-root"
	data-testid="scroll-root"
	style="overflow: auto; position: relative;"
>
	{#if topSpacerHeight > 0}
		<div
			data-testid="top-spacer"
			style={`display: block; width: 100%; height: ${topSpacerHeight}px;`}
		></div>
	{/if}
	<div
		class="section-host"
		data-testid="section-host"
		style="position: relative; width: 330px; --ccl-box-size: 100px; --ccl-box-height: 120px; --ccl-box-gap: 10px; --ccl-box-cols-max: 4;"
	>
		{#if showHeader}
			<FlatCardGrid
				{items}
				getItemId={(item) => item}
				{initialVisibleCount}
				{loadMoreIncrement}
				{sectionId}
				{applicationStore}
				{paginationMode}
				{infiniteScrollRootMargin}
			>
				{#snippet header()}
					<div class="test-cell" data-testid="header-cell">Header</div>
				{/snippet}

				{#snippet item({ item, index })}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div class="test-cell" data-testid="item-cell" data-index={index}>
						<div
							class="cosense-card-links__box"
							data-testid="item-focus-target"
							data-ccl-interaction-id={`${item as string}-${index}`}
							data-index={index}
							tabindex="0"
						>
							{item as string}
						</div>
					</div>
				{/snippet}

				{#snippet empty()}
					<div data-testid="empty-cell">Empty</div>
				{/snippet}
			</FlatCardGrid>
		{:else}
			<FlatCardGrid
				{items}
				getItemId={(item) => item}
				{initialVisibleCount}
				{loadMoreIncrement}
				{sectionId}
				{applicationStore}
				{paginationMode}
				{infiniteScrollRootMargin}
			>
				{#snippet item({ item, index })}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div class="test-cell" data-testid="item-cell" data-index={index}>
						<div
							class="cosense-card-links__box"
							data-testid="item-focus-target"
							data-ccl-interaction-id={`${item as string}-${index}`}
							data-index={index}
							tabindex="0"
						>
							{item as string}
						</div>
					</div>
				{/snippet}

				{#snippet empty()}
					<div data-testid="empty-cell">Empty</div>
				{/snippet}
			</FlatCardGrid>
		{/if}
	</div>
</div>

<style>
	.test-cell {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.04);
	}
</style>
