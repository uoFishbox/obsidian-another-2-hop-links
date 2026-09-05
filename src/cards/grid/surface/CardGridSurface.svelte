<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import PooledCardGridRows from "./PooledCardGridRows.svelte";
	import type { Snippet } from "svelte";
	import type { ResultNavigationDirection } from "cards/navigation/resultFocus";
	import type { InteractionDescriptorResolverProvider } from "cards/interactions/interactionRegistry";
	import type {
		ProgrammaticScrollSnapshot,
		VirtualNavigationTarget,
		VirtualSequentialNavigationDirection,
		VirtualSequentialNavigationTarget,
	} from "cards/virtualization/public";
	import type { CardGridMountedRow } from "./cardGridSurfaceTypes";
	import { createCardSurfaceInteractions } from "../interaction/useCardGridInteractions.svelte";
	import type { MountedVirtualCell } from "cards/virtualization/public";

	interface CardGridSurfaceProps<TCell extends MountedVirtualCell> {
		className?: string;
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		mountedRows: readonly CardGridMountedRow<TCell>[];
		interactionDescriptorResolverProvider?: InteractionDescriptorResolverProvider;
		renderCell: Snippet<
			[{ mountedCell: TCell; scrollContainerEl: HTMLElement | null }]
		>;
		afterContent?: Snippet;
		rootEl?: HTMLDivElement | null;
		contentEl?: HTMLDivElement | null;
		interactionShadowRoot?: ShadowRoot | null;
		scrollContainerEl?: HTMLElement | null;
		getCellDataTestId?: (cell: TCell) => string | undefined;
		slotBodyRevision?: unknown;
		resolveNavigationTarget?: (
			currentKey: string,
			direction: ResultNavigationDirection,
			currentPosition: { rowIndex: number; columnIndex: number },
		) => VirtualNavigationTarget | null;
		resolveSequentialNavigationTarget?: (
			currentKey: string,
			direction: VirtualSequentialNavigationDirection,
			currentPosition: { rowIndex: number; columnIndex: number },
		) => VirtualSequentialNavigationTarget | null;
		flushVirtualScrollMeasurement?: (snapshot: ProgrammaticScrollSnapshot) => void;
	}

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
		interactionDescriptorResolverProvider = undefined,
		renderCell,
		afterContent,
		rootEl = $bindable<HTMLDivElement | null>(null),
		contentEl = $bindable<HTMLDivElement | null>(null),
		interactionShadowRoot = $bindable<ShadowRoot | null>(null),
		scrollContainerEl = null,
		getCellDataTestId,
		slotBodyRevision = undefined,
		resolveNavigationTarget,
		resolveSequentialNavigationTarget,
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
		getInteractionDescriptorResolverProvider: () =>
			interactionDescriptorResolverProvider,
		resolveNavigationTarget,
		resolveSequentialNavigationTarget,
		flushVirtualScrollMeasurement,
	});
	const {
		delegatedInteractions,
		handleKeyDown,
		handlePointerDown,
		handleFocusIn,
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
	onpointerdown={handlePointerDown}
	onfocusin={handleFocusIn}
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
		{getCellDataTestId}
		{slotBodyRevision}
		{cellBindingRegistry}
		{renderCell}
	/>
	{@render afterContent?.()}
</div>
