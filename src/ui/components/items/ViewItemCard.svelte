<script lang="ts">
	import type { ItemProps } from "./types";
	import LinkItem from "ui/components/common/LinkItem.svelte";
	import CardPreview from "features/card-preview/ui/CardPreview.svelte";
	import PreviewHost from "features/card-preview/ui/PreviewHost.svelte";
	import UnresolvedPreviewPlaceholder from "features/card-preview/ui/UnresolvedPreviewPlaceholder.svelte";
	import { getDebugDisableCardDomPreview } from "../../../appConstants";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

	let {
		settings,
		draggable = true,
		previewSlotId = undefined,
		model = undefined,
	}: ItemProps = $props();
	const renderState = $derived(model ?? null);

	const componentReevaluationProbe = $derived.by(() => {
		if (process.env.NODE_ENV === "production") return "";

		void settings;
		void draggable;
		void previewSlotId;
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
		interactionKind="item"
		{draggable}
		className={renderState.className ?? undefined}
		directory={renderState.directory}
		searchQuery={renderState.searchQuery}
		presentation={renderState.presentation}
	>
		{#snippet children()}
			{#if !getDebugDisableCardDomPreview() && renderState.item.type === "newLink" && !renderState.targetFile}
				<UnresolvedPreviewPlaceholder />
			{:else if !getDebugDisableCardDomPreview() && renderState.targetFile && previewSlotId}
				<PreviewHost slotId={previewSlotId} />
			{:else if !getDebugDisableCardDomPreview() && renderState.previewRequest}
				<CardPreview request={renderState.previewRequest} />
			{/if}
		{/snippet}
	</LinkItem>
{/if}
