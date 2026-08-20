<script lang="ts">
	import type { ItemProps } from "ui/components/items/types";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import { previewHost } from "features/card-preview/ui/previewHostAction";
	import UnresolvedPreviewPlaceholder from "features/card-preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { getDebugDisableCardDomPreview } from "../../../appConstants";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

	let {
		settings,
		draggable = true,
		previewKey = undefined,
		model = undefined,
	}: ItemProps = $props();
	const renderState = $derived(model ?? null);

	const componentReevaluationProbe = $derived.by(() => {
		if (process.env.NODE_ENV === "production") return "";

		void settings;
		void draggable;
		void previewKey;
		void model;
		void renderState;
		return markCCLComponentReevaluation("ViewItemCard");
	});
</script>

{componentReevaluationProbe}
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
			{#if !getDebugDisableCardDomPreview() && renderState.item.type === "newLink" && !renderState.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if !getDebugDisableCardDomPreview() && renderState.targetFile && previewKey}
				<div
					use:previewHost={previewKey}
					class="cosense-card-links__box-preview"
				></div>
			{/if}
		{/snippet}
	</LinkItem>
{/if}
