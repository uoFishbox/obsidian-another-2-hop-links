<script lang="ts">
	import TwoHopProgressiveSurface from "features/two-hop/ui/TwoHopProgressiveSurface.svelte";
	import { setLinkContext, type LinkContext } from "ui/context/linkContext";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";
	import type {
		TwoHopItemModel,
		TwoHopSectionModel,
	} from "features/two-hop/ui/twoHopSectionModel";

	interface Props {
		documentIdentity?: string;
		sections: readonly TwoHopSectionModel[];
		applicationStore: ApplicationStore;
		linkContext: LinkContext;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
		offscreenBootstrapPreviewRows?: number;
		cardModelRevision?: unknown;
		resolveItemCardModel: (
			item: TwoHopItemModel,
			presentation: TwoHopCardPresentationState,
			revision: unknown,
		) => CardRenderModel;
	}

	const {
		documentIdentity = "test-document",
		sections,
		applicationStore,
		linkContext,
		previewDependencies = undefined,
		previewActive = true,
		offscreenBootstrapPreviewRows = 0,
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
	{offscreenBootstrapPreviewRows}
	{cardModelRevision}
/>
