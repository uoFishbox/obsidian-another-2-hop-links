<script lang="ts">
	import TwoHopProgressiveSurface from "features/two-hop/ui/TwoHopProgressiveSurface.svelte";
	import { setLinkContext, type LinkContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";

	interface Props {
		documentIdentity?: string;
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		linkContext: LinkContext;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
		cardModelRevision?: unknown;
		resolveItemCardModel: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
	}

	const {
		documentIdentity = "test-document",
		sections,
		applicationStore,
		linkContext,
		previewDependencies = undefined,
		previewActive = true,
		cardModelRevision = 0,
		resolveItemCardModel,
	}: Props = $props();
	setLinkContext(linkContext);
</script>

<TwoHopProgressiveSurface
	{documentIdentity}
	{sections}
	{applicationStore}
	initialVisibleCount={sections[0]?.totalCount}
	{resolveItemCardModel}
	{previewDependencies}
	{previewActive}
	{cardModelRevision}
/>
