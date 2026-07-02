<script lang="ts" generics="TMountedCell extends MountedVirtualCell">
	import type { Snippet } from "svelte";
	import type { MountedVirtualCell } from "../types";
	import type { VirtualSurfaceCommonProps } from "./VirtualSurfaceProps";
	import { createVirtualSurfaceInteractions } from "./VirtualSurfaceInteractions.svelte";
	import { watchVirtualSurfaceMountedCellsChange } from "./VirtualSurfaceMountedCellsChange.svelte";
	import type {
		VirtualSurfaceMountedRow,
		VirtualSurfaceMountedRowSlot,
	} from "./VirtualSurfaceTypes";

	type Props<TMountedCell extends MountedVirtualCell> = Pick<
		VirtualSurfaceCommonProps<TMountedCell>,
		| "mountedCellsForChange"
		| "interactionDescriptorScopeId"
		| "interactionDescriptors"
		| "interactionDescriptorResolvers"
		| "interactionDescriptorResolverProvider"
		| "onMountedCellsChange"
		| "resolveNavigationTarget"
		| "moveFocusWithinList"
		| "flushVirtualScrollMeasurement"
	> & {
		className?: string;
		rootEl?: HTMLDivElement | null;
		contentEl?: HTMLDivElement | null;
		interactionShadowRoot?: ShadowRoot | null;
		observerRoot?: HTMLElement | null;
		rowHeight: number;
		layoutMode?: "absolute-cells" | "grid-rows";
		mountedCells?: readonly TMountedCell[];
		mountedRows?: readonly VirtualSurfaceMountedRow<TMountedCell>[];
		mountedRowSlots?: readonly VirtualSurfaceMountedRowSlot<TMountedCell>[];
		children?: Snippet;
	};

	let {
		className = "",
		rootEl = $bindable<HTMLDivElement | null>(null),
		contentEl = $bindable<HTMLDivElement | null>(null),
		interactionShadowRoot = $bindable<ShadowRoot | null>(null),
		observerRoot = null,
		rowHeight,
		layoutMode = "absolute-cells",
		mountedCells = undefined,
		mountedRows = undefined,
		mountedRowSlots = undefined,
		mountedCellsForChange,
		interactionDescriptorScopeId,
		interactionDescriptors = [],
		interactionDescriptorResolvers = [],
		interactionDescriptorResolverProvider = undefined,
		onMountedCellsChange,
		resolveNavigationTarget,
		moveFocusWithinList,
		flushVirtualScrollMeasurement,
		children,
	}: Props<TMountedCell> = $props();

	const { delegatedInteractions, handleKeyDown } = createVirtualSurfaceInteractions({
		getRootEl: () => rootEl,
		getContentEl: () => contentEl,
		getShadowRoot: () => interactionShadowRoot,
		setShadowRoot: (sr) => {
			interactionShadowRoot = sr;
		},
		getObserverRoot: () => observerRoot,
		getRowHeight: () => rowHeight,
		getInteractionDescriptorScopeId: () => interactionDescriptorScopeId,
		getInteractionDescriptors: () => interactionDescriptors,
		getInteractionDescriptorResolvers: () => interactionDescriptorResolvers,
		getInteractionDescriptorResolverProvider: () =>
			interactionDescriptorResolverProvider,
		resolveNavigationTarget,
		moveFocusWithinList,
		flushVirtualScrollMeasurement,
	});

	watchVirtualSurfaceMountedCellsChange<TMountedCell>({
		getRenderInput: () =>
			layoutMode === "grid-rows"
				? {
						layoutMode,
						...(mountedRowSlots
							? { mountedRowSlots }
							: { mountedRows: mountedRows ?? [] }),
					}
				: {
						layoutMode: "absolute-cells",
						mountedCells: mountedCells ?? [],
					},
		getMountedCellsForChange: () => mountedCellsForChange,
		onMountedCellsChange,
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
	{@render children?.()}
</div>
