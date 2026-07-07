<script lang="ts" generics="T">
	import { providePreviewActivationContexts } from "features/preview/scheduling/previewActivationContexts";
	import VirtualSurface from "./virtual-list/VirtualSurface.svelte";
	import VirtualListLoadMoreButton from "./virtual-list/VirtualListLoadMoreButton.svelte";
	import {
		useFlatVirtualGridList,
		type FlatVirtualGridListProps,
	} from "./virtual-list/svelte/useFlatVirtualGridList.svelte";

	const props: FlatVirtualGridListProps<T> = $props();
	providePreviewActivationContexts();
	const list = useFlatVirtualGridList(props);
</script>

{#if list.itemCount === 0}
	{@render props.empty?.()}
{:else}
	<VirtualSurface
		className={`cosense-card-links__virtual-grid ${list.className}`.trim()}
		contentClassName="cosense-card-links__virtual-grid-content"
		rowClassName="cosense-card-links__virtual-grid-row"
		cellClassName="cosense-card-links__virtual-grid-cell"
		contentHeight={list.contentHeight}
		cellWidth={list.layout.cellWidth}
		rowHeight={list.layout.rowHeight}
		columns={list.layout.columns}
		layoutMode="grid-rows"
		mountedRows={list.mountedRows}
		mountedCellsForChange={list.mountedCellsForChange}
		bind:rootEl={list.sectionRootEl}
		bind:contentEl={list.contentEl}
		bind:interactionShadowRoot={list.interactionShadowRoot}
		observerRoot={list.observerRoot}
		getCellPosition={list.getCellPosition}
		onMountedCellsChange={props.onMountedCellsChange}
		remountCellBodyOnKeyChange={props.remountCellBodyOnKeyChange}
		resolveNavigationTarget={list.resolveNavigationTarget}
		flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
	>
		{#snippet renderCell({ mountedCell, observerRoot })}
			{#if mountedCell.cell.kind === "header"}
				{@render props.header?.()}
			{:else if mountedCell.cell.kind === "item"}
				{#if props.item}
					{@const itemRenderArgs = list.createItemRenderArgs(
						mountedCell,
						observerRoot,
					)}
					{@render props.item(itemRenderArgs)}
				{/if}
			{:else}
				<VirtualListLoadMoreButton onClick={list.loadNextPage} />
			{/if}
		{/snippet}
		{#snippet afterContent()}
			{#if list.shouldUseInfiniteScroll && list.canLoadMore}
				<div
					bind:this={list.infiniteScrollSentinelEl}
					class="cosense-card-links__infinite-scroll-sentinel"
					style:top={`${list.layout.contentHeight}px`}
					aria-hidden="true"
				></div>
			{/if}
		{/snippet}
	</VirtualSurface>
{/if}

<style>
	:global(.cosense-card-links__virtual-grid) {
		position: relative;
		width: 100%;
		overflow-anchor: none;
	}

	:global(.cosense-card-links__virtual-grid-content) {
		position: relative;
		width: 100%;
	}

	:global(.cosense-card-links__virtual-grid-cell) {
		box-sizing: border-box;
		min-width: 0;
		width: var(--ccl-cell-width);
		flex: 0 0 var(--ccl-cell-width);
		height: var(--ccl-box-height);
	}

	:global(.cosense-card-links__virtual-grid-row) {
		position: relative;
		width: 100%;
		height: var(--ccl-box-height);
		display: flex;
		gap: var(--ccl-box-gap);
		contain: layout;
	}

	:global(.cosense-card-links__infinite-scroll-sentinel) {
		position: absolute;
		left: 0;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
</style>
