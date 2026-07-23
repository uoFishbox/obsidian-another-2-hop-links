<script lang="ts">
	import TwoHopSurface from "features/two-hop/ui/TwoHopSurface.svelte";
	import {
		setAppContext,
		setLinkContext,
		type AppContext,
		type LinkContext,
	} from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		linkContext: LinkContext;
		appContext?: AppContext;
		resolveItemCardModel: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
	}

	const {
		sections,
		applicationStore,
		linkContext,
		appContext = undefined,
		resolveItemCardModel,
	}: Props = $props();
	setLinkContext(linkContext);
	if (appContext) setAppContext(appContext);
</script>

<TwoHopSurface
	{sections}
	{applicationStore}
	initialVisibleCount={sections[0]?.totalCount}
	{resolveItemCardModel}
/>
