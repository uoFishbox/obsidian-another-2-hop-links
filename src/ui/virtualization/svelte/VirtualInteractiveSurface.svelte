<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import type { VirtualSurfaceCommonProps } from "./VirtualSurfaceProps";
	import { createVirtualSurfaceInteractions } from "./VirtualSurfaceInteractions.svelte";
	import { createVirtualGridSurfaceTransaction } from "./VirtualGridSurfaceTransaction";

	type Props<TMountedCell extends MountedVirtualCell> = Pick<
		VirtualSurfaceCommonProps<TMountedCell>,
		| "interactionDescriptorScopeId"
		| "interactionDescriptorResolverProvider"
		| "resolveNavigationTarget"
		| "flushVirtualScrollMeasurement"
	> & {
		className?: string;
		rootEl?: HTMLDivElement | null;
		contentEl?: HTMLDivElement | null;
		interactionShadowRoot?: ShadowRoot | null;
		observerRoot?: HTMLElement | null;
		rowHeight: number;
		children?: Snippet<[ReturnType<typeof createVirtualGridSurfaceTransaction>]>;
	};

	let {
		className = "",
		rootEl = $bindable<HTMLDivElement | null>(null),
		contentEl = $bindable<HTMLDivElement | null>(null),
		interactionShadowRoot = $bindable<ShadowRoot | null>(null),
		observerRoot = null,
		rowHeight,
		interactionDescriptorScopeId,
		interactionDescriptorResolverProvider = undefined,
		resolveNavigationTarget,
		flushVirtualScrollMeasurement,
		children,
	}: Props<TMountedCell> = $props();

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
	const { delegatedInteractions, handleKeyDown, touchEventHandlers } =
		surfaceInteractions;

	const surfaceTransaction = createVirtualGridSurfaceTransaction({
		onLogicalCellWillRebind: () => {
			delegatedInteractions.resetTransientState();
		},
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
	{...touchEventHandlers}
>
	{@render children?.(surfaceTransaction)}
</div>
