<script lang="ts">
	import ClickableHeader from "../ClickableHeader.svelte";
	import type { InteractionRegistry } from "ui/interactions/interactionRegistry";
	import { setInteractionRegistryContext } from "ui/interactions/interactionRegistry";
	import type { SectionHeaderInteractionDescriptor } from "ui/interactions/interactionTypes";

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

<ClickableHeader
	{title}
	{count}
	className=""
	{interactionId}
	interactionDescriptor={descriptor}
>
	{#snippet icon()}{/snippet}
</ClickableHeader>
