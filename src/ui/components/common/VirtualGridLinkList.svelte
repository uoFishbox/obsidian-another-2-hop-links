<script lang="ts" generics="T">
	import { setContext } from "svelte";
	import { ARIA_LABELS } from "../../../appConstants";
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import VirtualSurface from "./virtual-list/VirtualSurface.svelte";
	import {
		useFlatVirtualGridList,
		type FlatVirtualGridListProps,
	} from "./virtual-list/svelte/useFlatVirtualGridList.svelte";
	import {
		createPreviewActivationScope,
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
	} from "features/preview/scheduling/previewActivationScope";
	import {
		createRowPreviewActivationRuntime,
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	} from "features/preview/scheduling/rowPreviewActivationRuntime";

	const props: FlatVirtualGridListProps<T> = $props();
	const previewActivationScope = createPreviewActivationScope();
	const rowPreviewActivationRuntime = createRowPreviewActivationRuntime({
		scope: previewActivationScope,
	});
	setContext(PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY, previewActivationScope);
	setContext(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY, rowPreviewActivationRuntime);
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
		mountedCells={list.mountedCells}
		mountedRows={list.mountedRows}
		mountedCellsForChange={list.mountedCellsForChange}
		bind:rootEl={list.sectionRootEl}
		bind:contentEl={list.contentEl}
		bind:interactionShadowRoot={list.interactionShadowRoot}
		observerRoot={list.observerRoot}
		getCellPosition={list.getCellPosition}
		onMountedCellsChange={props.onMountedCellsChange}
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
				<button
					type="button"
					class="cosense-card-links__load-more-button cosense-card-links__box"
					aria-label={ARIA_LABELS.LOAD_MORE}
					onclick={list.loadNextPage}
				>
					<svg {...svgAttrs} width="28" height="28" stroke="currentColor">
						{@html ICON_PATHS.Ellipsis}
					</svg>
				</button>
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
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: var(--ccl-box-height);
		display: flex;
		gap: var(--ccl-box-gap);
		contain: layout paint;
	}

	:global(.cosense-card-links__infinite-scroll-sentinel) {
		position: absolute;
		left: 0;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
</style>
