<script lang="ts">
	import PreviewVisibilityProvider from "ui/components/items/PreviewVisibilityProvider.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import { IS_PROD } from "../../../appConstants";
	import type { PluginSettings } from "types/settings";
	import type { SearchWorkerMatchScope } from "features/search/searchWorkerTypes";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
	import type { ViewItem } from "application/presenters";
	import {
		resolveTwoHopItemInteractionKey,
		resolveTwoHopPageItemSearchScope,
	} from "./twoHopVirtualListModel";
	import { markCCLComponentReevaluation } from "infrastructure/debug/CCLDevMeasurements";

	interface Props {
		item: ViewItem;
		searchKey: string;
		virtualKey: string;
		interactionId?: string;
		interactionKey?: string;
		settings: PluginSettings;
		searchQuery: string;
		searchScope: SearchWorkerMatchScope;
		contentMatched?: boolean;
		contentPreview?: string;
		rowIndex: number;
		visibilityState: VirtualizedItemVisibilityState;
		activationCandidateId: string;
	}

	let {
		item,
		searchKey,
		virtualKey,
		interactionId,
		interactionKey: providedInteractionKey,
		settings,
		searchQuery,
		searchScope,
		contentMatched,
		contentPreview,
		rowIndex,
		visibilityState,
		activationCandidateId,
	}: Props = $props();

	const resolvedSearchScope = $derived(
		resolveTwoHopPageItemSearchScope(searchScope, contentMatched),
	);
	const resolvedInteractionKey = $derived(
		resolveTwoHopItemInteractionKey({
			item,
			virtualKey,
			interactionKey: providedInteractionKey,
		}),
	);
	const resolvedInteractionId = $derived(interactionId ?? resolvedInteractionKey);
	const componentReevaluationProbe = $derived.by(() => {
		if (IS_PROD) return "";

		void item;
		void searchKey;
		void virtualKey;
		void interactionId;
		void providedInteractionKey;
		void settings;
		void searchQuery;
		void searchScope;
		void contentMatched;
		void contentPreview;
		void rowIndex;
		void visibilityState;
		void activationCandidateId;
		void resolvedSearchScope;
		void resolvedInteractionKey;
		void resolvedInteractionId;
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
		{activationCandidateId}
		interactionRegistration="snapshot"
		interactionId={resolvedInteractionId}
		interactionKey={resolvedInteractionKey}
	/>
</PreviewVisibilityProvider>
