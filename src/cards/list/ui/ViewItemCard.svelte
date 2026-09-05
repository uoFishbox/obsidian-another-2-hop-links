<script lang="ts">
	import LinkItem from "cards/components/LinkItem.svelte";
	import type { CardRenderModel } from "cards/rendering/cardRenderModel";
	import { previewHost } from "card-preview/ui/previewHostAction";
	import UnresolvedPreviewPlaceholder from "card-preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import type { InteractionHandle } from "cards/interactions/interactionTypes";

	interface ItemProps {
		draggable?: boolean;
		previewKey?: string;
		model?: CardRenderModel;
		interactionHandle: InteractionHandle;
	}

	let {
		draggable = true,
		previewKey = undefined,
		model = undefined,
		interactionHandle,
	}: ItemProps = $props();
	const renderState = $derived(model ?? null);
</script>

{#if renderState}
	<LinkItem
		title={renderState.title}
		ariaLabel={renderState.ariaLabel}
		file={renderState.targetFile}
		extension={renderState.extension ?? undefined}
		{interactionHandle}
		interactive={Boolean(renderState.interactionDescriptor)}
		{draggable}
		className={renderState.className ?? undefined}
		searchQuery={renderState.searchQuery}
	>
		{#snippet children()}
			{#if renderState.item.type === "newLink" && !renderState.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if renderState.targetFile && previewKey}
				<div
					use:previewHost={previewKey}
					class="cosense-card-links__box-preview"
				></div>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
