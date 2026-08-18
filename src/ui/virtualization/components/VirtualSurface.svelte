<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import VirtualPooledGridRowsSurface from "../svelte/VirtualPooledGridRowsSurface.svelte";
	import type { VirtualSurfaceProps } from "../svelte/VirtualSurfaceProps";
	import { createVirtualSurfaceInteractions } from "../svelte/VirtualSurfaceInteractions.svelte";
	import type { MountedVirtualCell } from "../types";
	import { KEYED_VIRTUAL_CELL_BODY_LIFECYCLE } from "ui/virtualization/core/bodyLifecycle";

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
		observerRoot = null,
		getCellClassName,
		getCellDataTestId,
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement,
	}: VirtualSurfaceProps<TMountedCell> = $props();

	const surfaceInteractions = createVirtualSurfaceInteractions({
		getRootEl: () => rootEl,
		getContentEl: () => contentEl,
		getShadowRoot: () => interactionShadowRoot,
		setShadowRoot: (sr) => {
			interactionShadowRoot = sr;
		},
		getObserverRoot: () => observerRoot,
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
		surfaceTransaction,
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
	<VirtualPooledGridRowsSurface
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
		{observerRoot}
		{getCellClassName}
		{getCellDataTestId}
		{bodyLifecyclePolicy}
		{surfaceTransaction}
		{renderCell}
	/>
	{@render afterContent?.()}
</div>
