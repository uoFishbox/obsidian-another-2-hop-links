<script lang="ts">
	import TwoHopVirtualGrid from "../TwoHopVirtualGrid.svelte";
	import { setLinkContext, type LinkContext } from "cards/context/linkContext";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";
	import type { CardRenderModel } from "cards/rendering/cardRenderModel";
	import type {
		TwoHopItemModel,
		TwoHopSectionModel,
	} from "two-hop/ui/twoHopSectionModel";

	interface Props {
		sections: readonly TwoHopSectionModel[];
		layoutAnchorScope?: string;
		applicationStore: CardCollectionState;
		linkContext: LinkContext;
		previewActive?: boolean;
		cardModelRevision?: unknown;
		loadMoreSection?: (sectionId: string) => void;
		resolveItemCardModel: (
			item: TwoHopItemModel,
			revision: unknown,
		) => CardRenderModel;
	}

	const {
		sections,
		layoutAnchorScope = "default",
		applicationStore,
		linkContext,
		previewActive = true,
		cardModelRevision = 0,
		loadMoreSection = undefined,
		resolveItemCardModel,
	}: Props = $props();
	setLinkContext(linkContext);
</script>

<TwoHopVirtualGrid
	{sections}
	{layoutAnchorScope}
	{applicationStore}
	{loadMoreSection}
	{resolveItemCardModel}
	{previewActive}
	{cardModelRevision}
/>
