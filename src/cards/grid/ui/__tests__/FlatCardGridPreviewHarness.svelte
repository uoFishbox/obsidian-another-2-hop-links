<script lang="ts">
	import { setContext } from "svelte";
	import FlatCardGrid from "../FlatCardGrid.svelte";
	import ViewItemCard from "cards/list/ui/ViewItemCard.svelte";
	import {
		setAppContext,
		setLinkContext,
		type AppContext,
		type LinkContext,
	} from "cards/context/linkContext";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";
	import type { CardRenderModel } from "cards/rendering/cardRenderModel";

	interface Props {
		models: readonly CardRenderModel[];
		linkContext: LinkContext;
		appContext: AppContext;
		applicationStore: CardCollectionState;
		getItemId?: (model: CardRenderModel, index: number) => string;
	}

	let {
		models,
		linkContext,
		appContext,
		applicationStore,
		getItemId = (model) => model.interactionId,
	}: Props = $props();
	setLinkContext(linkContext);
	setAppContext(appContext);
	setContext<CardCollectionState>("applicationStore", applicationStore);
</script>

<div
	data-testid="scroll-root"
	style="overflow:auto;position:relative;width:330px;height:240px;"
>
	<FlatCardGrid
		items={models}
		{getItemId}
		initialVisibleCount={models.length}
		{applicationStore}
		resolveItemPreviewRequest={(model) => model.previewRequest}
		resolveItemInteractionDescriptor={(model) => model.interactionDescriptor}
	>
		{#snippet item({ item, previewKey, interactionHandle })}
			<ViewItemCard model={item} {previewKey} {interactionHandle} />
		{/snippet}
	</FlatCardGrid>
</div>
