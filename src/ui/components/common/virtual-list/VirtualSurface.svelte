<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import VirtualInteractiveSurface from "./svelte/VirtualInteractiveSurface.svelte";
	import VirtualSurfaceCells from "./svelte/VirtualSurfaceCells.svelte";
	import type { VirtualSurfaceProps } from "./svelte/VirtualSurfaceProps";
	import type { MountedVirtualCell } from "./types";
	import { KEYED_VIRTUAL_CELL_BODY_LIFECYCLE } from "ui/virtualization/bodyLifecycle";

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
		layoutMode = "absolute-cells",
		mountedCells = undefined,
		mountedRows = undefined,
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
		getCellPosition,
		getCellClassName,
		getCellDataTestId,
		onCellMount,
		onCellDestroy,
		onMountedCellsChange,
		bodyLifecyclePolicy = KEYED_VIRTUAL_CELL_BODY_LIFECYCLE,
		resolveNavigationTarget,
		moveFocusWithinList,
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
	{layoutMode}
	{mountedCells}
	{mountedRows}
	{mountedCellsForChange}
	{interactionDescriptorScopeId}
	{interactionDescriptors}
	{interactionDescriptorResolvers}
	{interactionDescriptorResolverProvider}
	{onMountedCellsChange}
	{resolveNavigationTarget}
	{moveFocusWithinList}
	{flushVirtualScrollMeasurement}
>
	{#if layoutMode === "grid-rows"}
		<VirtualSurfaceCells
			{contentClassName}
			{rowClassName}
			{cellClassName}
			{contentHeight}
			{cellWidth}
			{rowHeight}
			{columns}
			{gap}
			layoutMode="grid-rows"
			mountedRows={mountedRows ?? []}
			bind:contentEl
			{observerRoot}
			{getCellPosition}
			{getCellClassName}
			{getCellDataTestId}
			{onCellMount}
			{onCellDestroy}
			{bodyLifecyclePolicy}
			{renderCell}
		/>
	{:else}
		<VirtualSurfaceCells
			{contentClassName}
			{rowClassName}
			{cellClassName}
			{contentHeight}
			{cellWidth}
			{rowHeight}
			{columns}
			{gap}
			layoutMode="absolute-cells"
			mountedCells={mountedCells ?? []}
			bind:contentEl
			{observerRoot}
			{getCellPosition}
			{getCellClassName}
			{getCellDataTestId}
			{onCellMount}
			{onCellDestroy}
			{bodyLifecyclePolicy}
			{renderCell}
		/>
	{/if}
	{@render afterContent?.()}
</VirtualInteractiveSurface>
