<script lang="ts">
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import { previewHost } from "features/card-preview/ui/previewHostAction";
	import UnresolvedPreviewPlaceholder from "features/card-preview/ui/UnresolvedPreviewPlaceholder.svelte";

	interface ItemProps {
		draggable?: boolean;
		previewKey?: string;
		model?: CardRenderModel;
	}

	let {
		draggable = true,
		previewKey = undefined,
		model = undefined,
	}: ItemProps = $props();
	const renderState = $derived(model ?? null);
</script>

{#if renderState}
	<LinkItem
		title={renderState.title}
		ariaLabel={renderState.ariaLabel}
		file={renderState.targetFile}
		extension={renderState.extension ?? undefined}
		interactionId={renderState.interactionId}
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
