<script lang="ts">
	import TwoHopVirtualGrid from "../TwoHopVirtualGrid.svelte";
	import { setLinkContext, type LinkContext } from "ui/context/linkContext";
	import type { ApplicationUiState } from "application/stores/ApplicationUiState.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopPreviewDependencies } from "features/two-hop/runtime/virtual-grid/useTwoHopVirtualGrid.svelte";
	import type {
		TwoHopItemModel,
		TwoHopSectionModel,
	} from "features/two-hop/ui/twoHopSectionModel";

	interface Props {
		sections: readonly TwoHopSectionModel[];
		applicationStore: ApplicationUiState;
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
