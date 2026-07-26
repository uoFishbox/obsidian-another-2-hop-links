<script lang="ts">
	import TwoHopSurface from "features/two-hop/ui/TwoHopSurface.svelte";
	import { setLinkContext, type LinkContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		linkContext: LinkContext;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
		resolveItemCardModel: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
	}

	const {
		sections,
		applicationStore,
		linkContext,
		previewDependencies = undefined,
		previewActive = true,
		resolveItemCardModel,
	}: Props = $props();
	setLinkContext(linkContext);
</script>

<TwoHopSurface
	{sections}
	{applicationStore}
	initialVisibleCount={sections[0]?.totalCount}
	{resolveItemCardModel}
	{previewDependencies}
	{previewActive}
/>
