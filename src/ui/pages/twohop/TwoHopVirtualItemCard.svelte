<script lang="ts">
	import PreviewVisibilityProvider from "ui/components/items/PreviewVisibilityProvider.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { PluginSettings } from "types/settings";
	import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
	import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
	import type { TwoHopPageVirtualItem } from "./twohopPageVirtualModel";
	import { resolveTwoHopPageItemSearchScope } from "./twohopPageVirtualModel";

	interface Props {
		row: TwoHopPageVirtualItem;
		settings: PluginSettings;
		searchQuery: string;
		searchScope: SearchWorkerMatchScope;
		matchedItemByKey: Map<string, SearchWorkerMatchedItem> | null;
		rowIndex: number;
		visibilityState: VirtualizedItemVisibilityState;
		activationCandidateId: string;
	}

	let {
		row,
		settings,
		searchQuery,
		searchScope,
		matchedItemByKey,
		rowIndex,
		visibilityState,
		activationCandidateId,
	}: Props = $props();

	const matchedItem = $derived(matchedItemByKey?.get(row.searchKey));
	const resolvedSearchScope = $derived(
		resolveTwoHopPageItemSearchScope(row, searchScope, matchedItem?.contentMatched),
	);
</script>

<PreviewVisibilityProvider {visibilityState}>
	<ViewItemCard
		item={row.item}
		{settings}
		{searchQuery}
		searchScope={resolvedSearchScope}
		contentPreview={matchedItem?.contentPreview}
		{rowIndex}
		{activationCandidateId}
		interactionRegistration="snapshot"
		interactionId={row.interactionId}
		interactionKey={row.interactionKey}
	/>
</PreviewVisibilityProvider>
