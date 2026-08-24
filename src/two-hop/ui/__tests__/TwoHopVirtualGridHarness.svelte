<script lang="ts">
	import TwoHopVirtualGrid from "../TwoHopVirtualGrid.svelte";
	import { setLinkContext, type LinkContext } from "cards/context/linkContext";
	import type { CardCollectionState } from "cards/CardCollectionState.svelte";
	import type { CardRenderModel } from "cards/rendering/cardRenderModel";
	import type { TwoHopPreviewDependencies } from "two-hop/ui/virtual-grid/useTwoHopVirtualGrid.svelte";
	import type {
		TwoHopItemModel,
		TwoHopSectionModel,
	} from "two-hop/ui/twoHopSectionModel";

	interface Props {
		sections: readonly TwoHopSectionModel[];
		applicationStore: CardCollectionState;
		linkContext: LinkContext;
		previewDependencies?: TwoHopPreviewDependencies;
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
		applicationStore,
		linkContext,
		previewDependencies = undefined,
		previewActive = true,
		cardModelRevision = 0,
		loadMoreSection = undefined,
		resolveItemCardModel,
	}: Props = $props();
	setLinkContext(linkContext);
</script>

<TwoHopVirtualGrid
	{sections}
	{applicationStore}
	{loadMoreSection}
	{resolveItemCardModel}
	{previewDependencies}
	{previewActive}
	{cardModelRevision}
/>
