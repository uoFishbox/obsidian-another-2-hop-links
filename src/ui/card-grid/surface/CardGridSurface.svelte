<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import PooledCardGridRows from "./PooledCardGridRows.svelte";
	import type { CardGridSurfaceProps } from "./cardGridSurfaceProps";
	import { createCardSurfaceInteractions } from "../interaction/useCardGridInteractions.svelte";
	import type { MountedVirtualCell } from "ui/virtualization/public";

	let {
		className = "",
		contentClassName = "",
		rowClassName = "",
		cellClassName = "",
		contentHeight,
		cellWidth = undefined,
		rowHeight,
		columns = 1,
		gap = undefined,
		mountedRows,
		interactionDescriptorScopeId,
		interactionDescriptorResolverProvider = undefined,
		renderCell,
		afterContent,
		rootEl = $bindable<HTMLDivElement | null>(null),
		contentEl = $bindable<HTMLDivElement | null>(null),
		interactionShadowRoot = $bindable<ShadowRoot | null>(null),
		scrollContainerEl = null,
		getCellClassName,
		getCellDataTestId,
		slotBodyRevision = undefined,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement,
	}: CardGridSurfaceProps<TMountedCell> = $props();

	const surfaceInteractions = createCardSurfaceInteractions({
		getRootEl: () => rootEl,
		getContentEl: () => contentEl,
		getShadowRoot: () => interactionShadowRoot,
		setShadowRoot: (sr) => {
			interactionShadowRoot = sr;
		},
		getObserverRoot: () => scrollContainerEl,
		getRowHeight: () => rowHeight,
		getInteractionDescriptorScopeId: () => interactionDescriptorScopeId,
		getInteractionDescriptorResolverProvider: () =>
			interactionDescriptorResolverProvider,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement,
	});
	const {
		delegatedInteractions,
		handleKeyDown,
		cellBindingRegistry,
		touchEventHandlers,
	} = surfaceInteractions;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
<div
	class={className}
	bind:this={rootEl}
	onclick={delegatedInteractions.handleClick}
	onmousedown={delegatedInteractions.handleMouseDown}
	oncontextmenu={delegatedInteractions.handleContextMenu}
	onkeydown={handleKeyDown}
	ondragstart={delegatedInteractions.handleDragStart}
	{...touchEventHandlers}
>
	<PooledCardGridRows
		{contentClassName}
		{rowClassName}
		{cellClassName}
		{contentHeight}
		{cellWidth}
		{rowHeight}
		{columns}
		{gap}
		{mountedRows}
		bind:contentEl
		{scrollContainerEl}
		{getCellClassName}
		{getCellDataTestId}
		{slotBodyRevision}
		{cellBindingRegistry}
		{renderCell}
	/>
	{@render afterContent?.()}
</div>
