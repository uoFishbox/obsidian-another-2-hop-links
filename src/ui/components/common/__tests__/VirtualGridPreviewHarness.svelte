<script lang="ts">
	import { setContext } from "svelte";
	import VirtualGridLinkList from "../VirtualGridLinkList.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import {
		setAppContext,
		setLinkContext,
		type AppContext,
		type LinkContext,
	} from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";

	interface Props {
		models: readonly CardRenderModel[];
		linkContext: LinkContext;
		appContext: AppContext;
		applicationStore: ApplicationStore;
		getItemId?: (model: CardRenderModel, index: number) => string;
	}

	let {
		models,
		linkContext,
		appContext,
		applicationStore,
		getItemId = (model) => model.interactionKey,
	}: Props = $props();
	setLinkContext(linkContext);
	setAppContext(appContext);
	setContext<ApplicationStore>("applicationStore", applicationStore);
</script>

<div
	data-testid="scroll-root"
	style="overflow:auto;position:relative;width:330px;height:240px;"
>
	<VirtualGridLinkList
		items={models}
		{getItemId}
		initialVisibleCount={models.length}
		{applicationStore}
		resolveItemPreviewRequest={(model) => model.previewRequest}
		resolveItemInteractionDescriptor={(model) => model.interactionDescriptor}
		remountCellBodyOnKeyChange={false}
	>
		{#snippet item({ item, previewKey })}
			<ViewItemCard
				item={item.item}
				settings={applicationStore.settings}
				model={item}
				{previewKey}
			/>
		{/snippet}
	</VirtualGridLinkList>
</div>
