<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import VirtualInteractiveSurface from "../svelte/VirtualInteractiveSurface.svelte";
	import VirtualPooledGridRowsSurface from "../svelte/VirtualPooledGridRowsSurface.svelte";
	import type { VirtualSurfaceProps } from "../svelte/VirtualSurfaceProps";
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
</script>

<VirtualInteractiveSurface
	{className}
	bind:rootEl
	bind:contentEl
	bind:interactionShadowRoot
	{observerRoot}
	{rowHeight}
	{interactionDescriptorScopeId}
	{interactionDescriptorResolverProvider}
	{resolveNavigationTarget}
	{flushVirtualScrollMeasurement}
>
	{#snippet children(surfaceTransaction)}
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
	{/snippet}
</VirtualInteractiveSurface>
