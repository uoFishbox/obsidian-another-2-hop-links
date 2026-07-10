<script lang="ts">
	import PreviewVisibilityProvider from "ui/components/items/PreviewVisibilityProvider.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { PluginSettings } from "types/settings";
	import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
	import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
	import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";
	import { resolveTwoHopPageItemSearchScope } from "./twoHopVirtualListModel";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

	interface Props {
		row: TwoHopVirtualListItem;
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
	const componentReevaluationProbe = $derived.by(() => {
		if (process.env.NODE_ENV === "production") return "";

		void row;
		void settings;
		void searchQuery;
		void searchScope;
		void matchedItemByKey;
		void rowIndex;
		void visibilityState;
		void activationCandidateId;
		void matchedItem;
		void resolvedSearchScope;
		return markCCLComponentReevaluation("TwoHopVirtualItemCard");
	});
</script>

{componentReevaluationProbe}
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
