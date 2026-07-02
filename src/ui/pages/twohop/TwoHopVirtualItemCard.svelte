<script lang="ts">
	import PreviewVisibilityProvider from "ui/components/items/PreviewVisibilityProvider.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import { IS_PROD } from "../../../appConstants";
	import type { PluginSettings } from "types/settings";
	import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
	import type { ViewItem } from "application/presenters";
	import { resolveTwoHopPageItemSearchScope } from "./twoHopVirtualListModel";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";
	import { createItemInteractionKey } from "ui/interactions/interactionTypes";

	interface Props {
		item: ViewItem;
		searchKey: string;
		virtualKey: string;
		interactionId?: string;
		settings: PluginSettings;
		searchQuery: string;
		searchScope: SearchWorkerMatchScope;
		contentMatched?: boolean;
		contentPreview?: string;
		rowIndex: number;
		visibilityState: VirtualizedItemVisibilityState;
	}

	let {
		item,
		searchKey,
		virtualKey,
		interactionId,
		settings,
		searchQuery,
		searchScope,
		contentMatched,
		contentPreview,
		rowIndex,
		visibilityState,
	}: Props = $props();

	const resolvedSearchScope = $derived(
		resolveTwoHopPageItemSearchScope(searchScope, contentMatched),
	);
	const interactionKey = $derived(
		item ? createItemInteractionKey(item, virtualKey) : undefined,
	);
	const componentReevaluationProbe = $derived.by(() => {
		if (IS_PROD) return "";

		void item;
		void searchKey;
		void virtualKey;
		void interactionId;
		void settings;
		void searchQuery;
		void searchScope;
		void contentMatched;
		void contentPreview;
		void rowIndex;
		void visibilityState;
		void resolvedSearchScope;
		void interactionKey;
		return markCCLComponentReevaluation("TwoHopVirtualItemCard");
	});
</script>

{componentReevaluationProbe}
<PreviewVisibilityProvider {visibilityState}>
	<ViewItemCard
		{item}
		{settings}
		{searchQuery}
		searchScope={resolvedSearchScope}
		{contentPreview}
		{rowIndex}
		interactionRegistration="snapshot"
		{interactionId}
		{interactionKey}
	/>
</PreviewVisibilityProvider>
