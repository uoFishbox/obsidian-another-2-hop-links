<script lang="ts">
	import TwoHopProgressiveSurface from "features/two-hop/ui/TwoHopProgressiveSurface.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type {
		SearchWorkerMatchedItem,
		SearchWorkerMatchScope,
	} from "features/search/searchWorkerTypes";
	import type {
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
	} from "features/two-hop/ui/twoHopVirtualListModel";
	import type { TwoHopCardPresentationState } from "features/two-hop/ui/twoHopCellStaticState";
	import {
		createTwoHopCardRenderModelCache,
		type TwoHopCardModelRevision,
	} from "features/two-hop/ui/twoHopCardRenderModelCache";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { LinkUtilitiesContext } from "types/linkContext";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";

	interface Props {
		documentIdentity: string;
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: SearchWorkerMatchScope;
		matchedItemByKey?: Map<string, SearchWorkerMatchedItem> | null;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		linkContext: LinkUtilitiesContext;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
	}

	let {
		documentIdentity,
		sections,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		matchedItemByKey = null,
		initialVisibleCount,
		loadMoreIncrement,
		linkContext,
		previewDependencies = undefined,
		previewActive = true,
	}: Props = $props();

	const currentSettings = $derived(applicationStore.settings);
	const cardModelCache = createTwoHopCardRenderModelCache();
	function getPreviewRenderVersion(path: string): string {
		return applicationStore.getPreviewRenderVersion(path);
	}
	const cardModelRevision = $derived.by(
		(): TwoHopCardModelRevision => ({
			settings: currentSettings,
			searchQuery,
			searchScope,
			matchedItemByKey,
			linkContext,
			getPreviewRenderVersion,
			applicationUpdateVersion: applicationStore.updateVersion,
		}),
	);
	const resolveItemCardModel = $derived.by(() => {
		const revision = cardModelRevision;
		return (
			row: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => cardModelCache.resolve(row, presentation, revision);
	});
</script>

<TwoHopProgressiveSurface
	{documentIdentity}
	{sections}
	{applicationStore}
	{initialVisibleCount}
	{loadMoreIncrement}
	paginationScope={searchQuery}
	{resolveItemCardModel}
	{previewDependencies}
	{previewActive}
/>
