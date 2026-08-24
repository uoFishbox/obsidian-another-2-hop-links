<script lang="ts">
	import { setContext } from "svelte";
	import FlatCardGrid from "../FlatCardGrid.svelte";
	import ViewItemCard from "features/list-view/ui/ViewItemCard.svelte";
	import {
		setAppContext,
		setLinkContext,
		type AppContext,
		type LinkContext,
	} from "ui/context/linkContext";
	import type { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";

	interface Props {
		models: readonly CardRenderModel[];
		linkContext: LinkContext;
		appContext: AppContext;
		applicationStore: ApplicationUiState;
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
	setContext<ApplicationUiState>("applicationStore", applicationStore);
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
		{#snippet item({ item, previewKey })}
			<ViewItemCard model={item} {previewKey} />
		{/snippet}
	</FlatCardGrid>
</div>
