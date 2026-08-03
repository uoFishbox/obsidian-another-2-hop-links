<script lang="ts">
	import type { Snippet } from "svelte";
	import type { InteractionDescriptorResolverProvider } from "ui/interactions/interactionRegistry";
	import { createVirtualSurfaceInteractions } from "ui/virtualization/svelte/VirtualSurfaceInteractions.svelte";

	interface Props {
		className?: string;
		rootEl?: HTMLDivElement | null;
		contentEl?: HTMLDivElement | null;
		observerRoot?: HTMLElement | null;
		rowHeight: number;
		interactionDescriptorScopeId?: string;
		interactionDescriptorResolverProvider?: InteractionDescriptorResolverProvider;
		children?: Snippet;
	}

	let {
		className = "",
		rootEl = $bindable<HTMLDivElement | null>(null),
		contentEl = $bindable<HTMLDivElement | null>(null),
		observerRoot = null,
		rowHeight,
		interactionDescriptorScopeId,
		interactionDescriptorResolverProvider,
		children,
	}: Props = $props();
	let interactionShadowRoot = $state<ShadowRoot | null>(null);

	const { delegatedInteractions, handleKeyDown } = createVirtualSurfaceInteractions({
		getRootEl: () => rootEl,
		getContentEl: () => contentEl,
		getShadowRoot: () => interactionShadowRoot,
		setShadowRoot: (shadowRoot) => {
			interactionShadowRoot = shadowRoot;
		},
		getObserverRoot: () => observerRoot,
		getRowHeight: () => rowHeight,
		getInteractionDescriptorScopeId: () => interactionDescriptorScopeId,
		getInteractionDescriptors: () => [],
		getInteractionDescriptorResolvers: () => [],
		getInteractionDescriptorResolverProvider: () =>
			interactionDescriptorResolverProvider,
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
