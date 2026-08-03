<script lang="ts">
	import TwoHopProgressiveSurface from "features/two-hop/ui/TwoHopProgressiveSurface.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type {
		SearchWorkerMatchedItem,
		SearchWorkerMatchScope,
	} from "features/search/searchWorkerTypes";
	import type { TwoHopSectionModel } from "features/two-hop/ui/twoHopSectionModel";
	import {
		buildTwoHopCardModel,
		type TwoHopCardModelRevision,
	} from "features/two-hop/ui/twoHopCardModel";
	import type { LinkUtilitiesContext } from "types/linkContext";
	import type { TwoHopPreviewDependencies } from "features/two-hop/ui/twoHopPreviewDependencies";

	interface Props {
		documentIdentity: string;
		sections: readonly TwoHopSectionModel[];
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: SearchWorkerMatchScope;
		matchedItemByKey?: Map<string, SearchWorkerMatchedItem> | null;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		linkContext: LinkUtilitiesContext;
		previewDependencies?: TwoHopPreviewDependencies;
		previewActive?: boolean;
		offscreenBootstrapPreviewRows?: number;
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
		offscreenBootstrapPreviewRows = 0,
	}: Props = $props();

	const currentSettings = $derived(applicationStore.settings);
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
	const resolveItemCardModel = (
		item: Parameters<typeof buildTwoHopCardModel>[0],
		presentation: Parameters<typeof buildTwoHopCardModel>[1],
		revision: unknown,
	) => buildTwoHopCardModel(item, presentation, revision as TwoHopCardModelRevision);
</script>

<TwoHopProgressiveSurface
	{documentIdentity}
	{sections}
	{applicationStore}
	{initialVisibleCount}
	{loadMoreIncrement}
	paginationScope={searchQuery}
	{cardModelRevision}
	{resolveItemCardModel}
	{previewDependencies}
	{previewActive}
	{offscreenBootstrapPreviewRows}
/>
