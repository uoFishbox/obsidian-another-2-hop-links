<script lang="ts">
	import type { Snippet } from "svelte";
	import ClickableHeader from "shared/ui/primitives/ClickableHeader.svelte";
	import { useInteractionRegistry } from "cards/interactions/interactionRegistry";
	import {
		createInteractionHandle,
		type SectionHeaderInteractionDescriptor,
	} from "cards/interactions/interactionTypes";
	import type { CardSectionVariant } from "cards/components/cardPresentation";

	export interface Props {
		title: string;
		count: number;
		icon: Snippet;
		className?: string;
		draggable?: boolean;
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
		interactionDescriptor,
		onClick,
		sectionVariant,
	}: Props = $props();

	const interactionRegistry = useInteractionRegistry();
	const interactionHandle = createInteractionHandle("h");
	const dataAttributes = $derived({
		"data-ccl-interaction-handle": interactionHandle,
		"data-ccl-section-variant": sectionVariant,
	});

	function registerInteractionDescriptor(): (() => void) | undefined {
		const descriptor = interactionDescriptor;
		if (!interactionRegistry || !descriptor) return;

		return interactionRegistry.register(interactionHandle, descriptor);
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
