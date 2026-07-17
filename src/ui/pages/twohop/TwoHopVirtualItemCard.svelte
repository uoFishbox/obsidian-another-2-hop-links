<script lang="ts">
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import type { PluginSettings } from "types/settings";
	import type { SearchWorkerMatchedItem } from "features/search/searchWorkerTypes";
	import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
	import type { TwoHopVirtualListItem } from "./twoHopVirtualListModel";
	import { resolveTwoHopPageItemSearchScope } from "./twoHopVirtualListModel";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";
	import type { TwoHopCardPresentationState } from "./twoHopCellBinding";

	interface Props {
		row: TwoHopVirtualListItem;
		settings: PluginSettings;
		searchQuery: string;
		searchScope: SearchWorkerMatchScope;
		matchedItemByKey: Map<string, SearchWorkerMatchedItem> | null;
		rowIndex: number;
		activationCandidateId: string;
		presentation: TwoHopCardPresentationState;
	}

	let {
		row,
		settings,
		searchQuery,
		searchScope,
		matchedItemByKey,
		rowIndex,
		activationCandidateId,
		presentation,
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
		void activationCandidateId;
		void presentation;
		void matchedItem;
		void resolvedSearchScope;
		return markCCLComponentReevaluation("TwoHopVirtualItemCard");
	});
</script>

{componentReevaluationProbe}
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
	{presentation}
/>
