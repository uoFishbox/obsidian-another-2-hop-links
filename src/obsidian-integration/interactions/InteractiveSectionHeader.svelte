<script lang="ts">
	import type { Snippet } from "svelte";
	import ClickableHeader from "shared/ui/primitives/ClickableHeader.svelte";
	import { useInteractionRegistry } from "cards/interactions/interactionRegistry";
	import type { SectionHeaderInteractionDescriptor } from "cards/interactions/interactionTypes";
	import type { CardSectionVariant } from "cards/components/cardPresentation";

	export interface Props {
		title: string;
		count: number;
		icon: Snippet;
		className?: string;
		draggable?: boolean;
		interactionId: string;
		interactionDescriptor?: SectionHeaderInteractionDescriptor;
		onClick?: () => void;
		sectionVariant?: CardSectionVariant;
	}

	let {
		title,
		count,
		icon,
		className = "",
		draggable = false,
		interactionId,
		interactionDescriptor,
		onClick,
		sectionVariant,
	}: Props = $props();

	const interactionRegistry = useInteractionRegistry();
	const dataAttributes = $derived({
		"data-ccl-interaction-id": interactionId,
		"data-ccl-section-variant": sectionVariant,
	});

	function registerInteractionDescriptor(): (() => void) | undefined {
		const descriptor = interactionDescriptor;
		if (!interactionRegistry || !descriptor) return;

		interactionRegistry.register(descriptor);
		return () => interactionRegistry.unregister(descriptor.interactionId);
	}

	$effect(() => registerInteractionDescriptor());
</script>

<ClickableHeader
	{title}
	{count}
	{icon}
	{className}
	{draggable}
	onclick={onClick}
	{dataAttributes}
/>
