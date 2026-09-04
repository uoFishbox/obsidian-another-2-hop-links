<script lang="ts">
	import InteractiveSectionHeader from "../InteractiveSectionHeader.svelte";
	import type { InteractionRegistry } from "cards/interactions/interactionRegistry";
	import { setInteractionRegistryContext } from "cards/interactions/interactionRegistry";
	import type { SectionHeaderInteractionDescriptor } from "cards/interactions/interactionTypes";

	interface Props {
		registry: InteractionRegistry;
		descriptors: readonly SectionHeaderInteractionDescriptor[];
	}

	let { registry, descriptors }: Props = $props();
	setInteractionRegistryContext(registry);
</script>

{#each descriptors as descriptor}
	<InteractiveSectionHeader
		title={descriptor.interactionId}
		count={1}
		className=""
		interactionId={descriptor.interactionId}
		interactionDescriptor={descriptor}
	>
		{#snippet icon()}{/snippet}
	</InteractiveSectionHeader>
{/each}
