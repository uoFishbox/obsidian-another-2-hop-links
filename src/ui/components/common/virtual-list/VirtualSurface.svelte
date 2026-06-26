<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import { onDestroy, tick, type Snippet, untrack } from "svelte";
	import { createDelegatedInteractionDispatcher } from "ui/interactions/delegatedDispatcher";
	import {
		createInteractionRegistry,
		setInteractionRegistryContext,
	} from "ui/interactions/interactionRegistry";
	import { useAppContext, useLinkContext } from "ui/context/linkContext";
	import type { ResultNavigationDirection } from "features/keyboard-navigation/resultFocus";
	import type { InteractionDescriptor } from "ui/interactions/interactionTypes";
	import type {
		InteractionDescriptorResolver,
		InteractionDescriptorResolverProvider,
	} from "ui/interactions/interactionRegistry";
	import VirtualSurfaceCells, {
		type VirtualSurfaceCellPosition,
		type VirtualSurfaceMountedRow,
	} from "./svelte/VirtualSurfaceCells.svelte";
	import { installVirtualListInteractions } from "./svelte/VirtualListInteractions.svelte";
	import {
		createVirtualSurfaceNavigation,
		type VirtualSurfaceNavigationContext,
	} from "./svelte/VirtualSurfaceNavigation";
	import type { MountedVirtualCell, VirtualNavigationTarget } from "./types";
	import type { RowKey } from "./rowKey";

	interface Props<TMountedCell extends MountedVirtualCell> {
		className?: string;
		contentClassName?: string;
		rowClassName?: string;
		cellClassName?: string;
		contentHeight: number;
		cellWidth?: number;
		rowHeight: number;
		columns?: number;
		gap?: number;
		layoutMode?: "absolute-cells" | "grid-rows";
		mountedCells: readonly TMountedCell[];
		mountedRows?: readonly VirtualSurfaceMountedRow<TMountedCell>[];
		mountedRowsVersion?: number;
		mountedCellsForChange?: readonly TMountedCell[];
		interactionDescriptorScopeId?: string;
		interactionDescriptors?: readonly InteractionDescriptor[];
		interactionDescriptorResolvers?: readonly InteractionDescriptorResolver[];
		interactionDescriptorResolverProvider?: InteractionDescriptorResolverProvider;
		renderCell: Snippet<
			[
				{
					mountedCell: TMountedCell;
					observerRoot: HTMLElement | null;
				},
			]
		>;
		afterContent?: Snippet;
		rootEl?: HTMLDivElement | null;
		contentEl?: HTMLDivElement | null;
		interactionShadowRoot?: ShadowRoot | null;
		observerRoot?: HTMLElement | null;
		getCellPosition?: (cell: TMountedCell) => VirtualSurfaceCellPosition;
		getCellClassName?: (cell: TMountedCell) => string | undefined;
		getCellDataTestId?: (cell: TMountedCell) => string | undefined;
		getRowRenderKey?: (rowIndex: number) => RowKey | undefined;
		getRowDataAttributes?: (
			rowIndex: number,
		) => Record<string, string | number | undefined> | undefined;
		onCellMount?: (cell: TMountedCell) => void;
		onCellDestroy?: (cell: TMountedCell) => void;
		onMountedCellsChange?: (cells: readonly TMountedCell[]) => void;
		resolveNavigationTarget?: (
			currentKey: string,
			direction: ResultNavigationDirection,
			currentPosition: {
				rowIndex: number;
				columnIndex: number;
			},
		) => VirtualNavigationTarget | null;
		moveFocusWithinList?: (
			currentTarget: HTMLElement,
			direction: ResultNavigationDirection,
			context: VirtualSurfaceNavigationContext,
		) => Promise<boolean>;
		flushVirtualScrollMeasurement?: (
			scrollContainerEl: HTMLElement | null,
			targetTop: number,
		) => void;
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
		layoutMode = "absolute-cells",
		mountedCells,
		mountedRows = undefined,
		mountedRowsVersion = undefined,
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
		getRowRenderKey,
		getRowDataAttributes,
		onCellMount,
		onCellDestroy,
		onMountedCellsChange,
		resolveNavigationTarget,
		moveFocusWithinList,
		flushVirtualScrollMeasurement,
	}: Props<TMountedCell> = $props();

	const interactionRegistry = createInteractionRegistry();
	setInteractionRegistryContext(interactionRegistry);

	let appContext: ReturnType<typeof useAppContext> | undefined;
	let linkContext: ReturnType<typeof useLinkContext> | undefined;
	try {
		appContext = useAppContext();
	} catch {
		appContext = undefined;
	}
	try {
		linkContext = useLinkContext();
	} catch {
		linkContext = appContext?.linkContext;
	}

	const delegatedInteractions = createDelegatedInteractionDispatcher({
		registry: interactionRegistry,
		linkContext,
		appContext,
	});

	const flushMountedState = async (): Promise<void> => {
		await tick();
	};

	const handleKeyDown = createVirtualSurfaceNavigation({
		getRootEl: () => rootEl,
		getContentEl: () => contentEl,
		getScrollContainerEl: () => observerRoot,
		getRowHeight: () => rowHeight,
		delegatedInteractions,
		resolveNavigationTarget,
		moveFocusWithinList,
		flushVirtualScrollMeasurement,
		flushMountedState,
	});

	installVirtualListInteractions({
		getRootEl: () => rootEl,
		getContentEl: () => contentEl,
		getShadowRoot: () => interactionShadowRoot,
		setShadowRoot: (sr) => {
			interactionShadowRoot = sr;
		},
		delegatedInteractions,
		interactionRegistry,
		linkContext,
		appContext,
	});

	let lastNotifiedCells: readonly TMountedCell[] | undefined;

	function notifyMountedCellsChange(): void {
		if (!onMountedCellsChange) return;
		const cells = mountedCellsForChange ?? mountedCells;
		if (cells === lastNotifiedCells) return;
		lastNotifiedCells = cells;
		untrack(() => onMountedCellsChange?.(cells));
	}

	$effect(() => {
		notifyMountedCellsChange();
	});

	let syncedInteractionDescriptorScopeId: string | undefined;
	let syncedInteractionDescriptorResolverProviderScopeId: string | undefined;

	function clearInteractionDescriptorScope(scopeId: string): void {
		interactionRegistry.syncInteractionDescriptors(scopeId, []);
		interactionRegistry.syncInteractionDescriptorResolvers(scopeId, []);
		interactionRegistry.syncInteractionDescriptorResolverProvider(
			scopeId,
			undefined,
		);
	}

	$effect(() => {
		if (
			syncedInteractionDescriptorScopeId &&
			syncedInteractionDescriptorScopeId !== interactionDescriptorScopeId
		) {
			clearInteractionDescriptorScope(syncedInteractionDescriptorScopeId);
		}
		if (
			syncedInteractionDescriptorResolverProviderScopeId &&
			(syncedInteractionDescriptorResolverProviderScopeId !==
				interactionDescriptorScopeId ||
				!interactionDescriptorResolverProvider)
		) {
			interactionRegistry.syncInteractionDescriptorResolverProvider(
				syncedInteractionDescriptorResolverProviderScopeId,
				undefined,
			);
			syncedInteractionDescriptorResolverProviderScopeId = undefined;
		}
		syncedInteractionDescriptorScopeId = interactionDescriptorScopeId;

		if (!interactionDescriptorScopeId) return;

		interactionRegistry.syncInteractionDescriptors(
			interactionDescriptorScopeId,
			interactionDescriptors,
		);
		interactionRegistry.syncInteractionDescriptorResolvers(
			interactionDescriptorScopeId,
			interactionDescriptorResolvers,
		);
		if (interactionDescriptorResolverProvider) {
			interactionRegistry.syncInteractionDescriptorResolverProvider(
				interactionDescriptorScopeId,
				interactionDescriptorResolverProvider,
			);
			syncedInteractionDescriptorResolverProviderScopeId =
				interactionDescriptorScopeId;
		}
	});

	onDestroy(() => {
		if (!syncedInteractionDescriptorScopeId) return;
		clearInteractionDescriptorScope(syncedInteractionDescriptorScopeId);
	});
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
	ontouchstart={delegatedInteractions.handleTouchStart}
	ontouchmove={delegatedInteractions.handleTouchMove}
	ontouchend={delegatedInteractions.handleTouchEnd}
	ontouchcancel={delegatedInteractions.handleTouchEnd}
>
	<VirtualSurfaceCells
		{contentClassName}
		{rowClassName}
		{cellClassName}
		{contentHeight}
		{cellWidth}
		{rowHeight}
		{columns}
		{gap}
		{layoutMode}
		{mountedCells}
		{mountedRows}
		{mountedRowsVersion}
		bind:contentEl
		{observerRoot}
		{getCellPosition}
		{getCellClassName}
		{getCellDataTestId}
		{getRowRenderKey}
		{getRowDataAttributes}
		{onCellMount}
		{onCellDestroy}
		{renderCell}
	/>
	{@render afterContent?.()}
</div>
