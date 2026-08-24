<script lang="ts">
	import InteractiveSectionHeader from "../InteractiveSectionHeader.svelte";
	import type { InteractionRegistry } from "cards/interactions/interactionRegistry";
	import { setInteractionRegistryContext } from "cards/interactions/interactionRegistry";
	import type { SectionHeaderInteractionDescriptor } from "cards/interactions/interactionTypes";

	interface Props {
		registry: InteractionRegistry;
		title?: string;
		count?: number;
		interactionId?: string;
		descriptor?: SectionHeaderInteractionDescriptor;
	}

	let {
		registry,
		title = "Header",
		count = 1,
		interactionId = "section:test",
		descriptor,
	}: Props = $props();

	setInteractionRegistryContext(registry);
</script>

<InteractiveSectionHeader
	{title}
	{count}
	className=""
	{interactionId}
	interactionDescriptor={descriptor}
>
	{#snippet icon()}{/snippet}
</InteractiveSectionHeader>
