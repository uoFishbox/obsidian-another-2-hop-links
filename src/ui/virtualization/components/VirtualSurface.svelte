<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import VirtualInteractiveSurface from "../svelte/VirtualInteractiveSurface.svelte";
	import VirtualSurfaceCells from "../svelte/VirtualSurfaceCells.svelte";
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
		mountedCellsForChange,
		interactionDescriptorScopeId,
		interactionDescriptors = [],
		interactionDescriptorResolvers = [],
		interactionDescriptorResolverProvider = undefined,
		renderCell,
		afterContent,
		rootEl = $bindable<HTMLDivElement | null>(null),
		contentEl = $bindable<HTMLDivElement | null>(null),
		interactionShadowRoot = $bindable<ShadowRoot | null>(null),
		observerRoot = null,
		getCellClassName,
		getCellDataTestId,
		onCellMount,
		onCellDestroy,
		onMountedCellsChange,
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		resolveNavigationTarget,
		moveFocusWithinList,
		flushVirtualScrollMeasurement,
		cellRegistry,
	}: VirtualSurfaceProps<TMountedCell> = $props();
</script>

<VirtualInteractiveSurface
	{className}
	bind:rootEl
	bind:contentEl
	bind:interactionShadowRoot
	{observerRoot}
	{rowHeight}
	{mountedCellsForChange}
	{interactionDescriptorScopeId}
	{interactionDescriptors}
	{interactionDescriptorResolvers}
	{interactionDescriptorResolverProvider}
	{onMountedCellsChange}
	{resolveNavigationTarget}
	{moveFocusWithinList}
	{flushVirtualScrollMeasurement}
	{cellRegistry}
>
	{#snippet children(surfaceTransaction)}
		<VirtualSurfaceCells
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
			{onCellMount}
			{onCellDestroy}
			{bodyLifecyclePolicy}
			{cellRegistry}
			{surfaceTransaction}
			{renderCell}
		/>
		{@render afterContent?.()}
	{/snippet}
</VirtualInteractiveSurface>
