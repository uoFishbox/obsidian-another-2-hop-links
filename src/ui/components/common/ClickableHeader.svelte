<script lang="ts">
	import type { Snippet } from "svelte";
	import type { PluginSettings } from "types/settings";
	import type { SectionHeaderInteractionDescriptor } from "ui/interactions/interactionTypes";
	import { useInteractionRegistry } from "ui/interactions/interactionRegistry";

	export interface Props {
		title: string;
		count: number;
		icon: Snippet;
		className?: string;
		draggable?: boolean;
		directory?: string | null;
		settings?: PluginSettings;
		interactionId: string;
		interactionKind: "sectionHeader";
		interactionDescriptor?: SectionHeaderInteractionDescriptor;
		onClick?: () => void;
	}

	let {
		title,
		count,
		icon,
		className = "",
		draggable = false,
		directory = null,
		settings,
		interactionId,
		interactionKind,
		interactionDescriptor,
		onClick,
	}: Props = $props();

	const interactionRegistry = useInteractionRegistry();

	function registerInteractionDescriptor(): (() => void) | undefined {
		if (!interactionRegistry || !interactionDescriptor) {
			return;
		}

		interactionRegistry.register(interactionDescriptor);
		return () => {
			interactionRegistry.unregister(interactionDescriptor.interactionId);
		};
	}

	$effect(() => {
		return registerInteractionDescriptor();
	});

	const ariaLabel = $derived(`${count} notes`);
</script>

<div
	class="cosense-card-links__box cosense-card-links__twohop-header {className}"
	role="button"
	tabindex="0"
	aria-label={ariaLabel}
	{draggable}
	data-ccl-interaction-id={interactionId}
	data-ccl-interaction-kind={interactionKind}
	data-directory={directory}
	onclick={() => onClick?.()}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClick?.();
		}
	}}
>
	<div class="cosense-card-links__title-container">
		<span class="cosense-card-links__header-title">{title}</span>
	</div>
	{@render icon()}
</div>
