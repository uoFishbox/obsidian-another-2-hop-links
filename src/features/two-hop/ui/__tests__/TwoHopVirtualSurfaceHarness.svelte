<script lang="ts">
	import TwoHopVirtualSurface from "features/two-hop/ui/TwoHopVirtualSurface.svelte";
	import { setLinkContext, type LinkContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/useTwoHopVirtualList.svelte";
	import type {
		TwoHopItemModel,
		TwoHopSectionModel,
	} from "features/two-hop/ui/twoHopSectionModel";

	interface Props {
		sections: readonly TwoHopSectionModel[];
		applicationStore: ApplicationStore;
		linkContext: LinkContext;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
		offscreenBootstrapPreviewRows?: number;
		cardModelRevision?: unknown;
		loadMoreSection?: (sectionId: string) => void;
		resolveItemCardModel: (
			item: TwoHopItemModel,
			presentation: TwoHopCardPresentationState,
			revision: unknown,
		) => CardRenderModel;
	}

	const {
		sections,
		applicationStore,
		linkContext,
		previewDependencies = undefined,
		previewActive = true,
		offscreenBootstrapPreviewRows = 0,
		cardModelRevision = 0,
		loadMoreSection = undefined,
		resolveItemCardModel,
	}: Props = $props();
	setLinkContext(linkContext);
</script>

<TwoHopVirtualSurface
	{sections}
	{applicationStore}
	{loadMoreSection}
	{resolveItemCardModel}
	{previewDependencies}
	{previewActive}
	{offscreenBootstrapPreviewRows}
	{cardModelRevision}
/>
