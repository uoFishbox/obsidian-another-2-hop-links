<script lang="ts">
	import { getContext } from "svelte";
	import TwoHopViewPlanVirtualList from "./TwoHopVirtualListSurface.svelte";
	import TwoHopSectionHeaderRenderer from "./TwoHopSectionHeaderRenderer.svelte";
	import TwoHopVirtualItemCard from "./TwoHopVirtualItemCard.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type {
		SearchWorkerMatchedItem,
		SearchWorkerMatchScope,
	} from "features/search/searchWorkerTypes";
	import type {
		TwoHopVirtualListSection,
		TwoHopVirtualListItem,
		TwoHopVirtualSectionDescriptor,
		TwoHopVirtualItemRenderCell,
	} from "./twoHopVirtualListModel";
	import { useLinkContext } from "ui/context/linkContext";
	import {
		createTwoHopInteractionDescriptorRevision,
		resolveTwoHopItemInteractionDescriptor,
	} from "./twoHopInteractionDescriptorRevision";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: SearchWorkerMatchScope;
		matchedItemByKey?: Map<string, SearchWorkerMatchedItem> | null;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
	}

	let {
		sections,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		matchedItemByKey = null,
		initialVisibleCount,
		loadMoreIncrement,
	}: Props = $props();

	if (!applicationStore) {
		applicationStore = getContext<ApplicationStore>("applicationStore");
	}

	const currentSettings = $derived(applicationStore.settings);
	let linkContext: ReturnType<typeof useLinkContext> | undefined;
	try {
		linkContext = useLinkContext();
	} catch {
		linkContext = undefined;
	}
	const getCellClassName = (section: TwoHopVirtualListSection): string | undefined =>
		section.className;

	const getItemInteractionDescriptor = (row: TwoHopVirtualListItem) =>
		resolveTwoHopItemInteractionDescriptor(row, interactionDescriptorRevision);
	const interactionDescriptorRevision = $derived(
		createTwoHopInteractionDescriptorRevision({
			settings: currentSettings,
			searchQuery,
			linkContext,
		}),
	);
</script>

{#if sections.length > 0}
	<TwoHopViewPlanVirtualList
		{sections}
		{applicationStore}
		{initialVisibleCount}
		{loadMoreIncrement}
		{getCellClassName}
		{getItemInteractionDescriptor}
		{interactionDescriptorRevision}
	>
		{#snippet renderHeader({ section, title, totalCount, sectionId, headerProps })}
			<TwoHopSectionHeaderRenderer
				{section}
				{title}
				{totalCount}
				{sectionId}
				{headerProps}
			/>
		{/snippet}

		{#snippet renderItem(cell: TwoHopVirtualItemRenderCell)}
			{@const matchedItem = matchedItemByKey?.get(cell.searchKey) ?? null}
			<TwoHopVirtualItemCard
				item={cell.item}
				searchKey={cell.searchKey}
				virtualKey={cell.virtualKey}
				interactionId={cell.interactionId}
				settings={currentSettings}
				{searchQuery}
				{searchScope}
				contentMatched={matchedItem?.contentMatched}
				contentPreview={matchedItem?.contentPreview}
				rowIndex={cell.rowIndex}
				visibilityState={cell.visibilityState}
				activationCandidateId={cell.activationCandidateId}
			/>
		{/snippet}
	</TwoHopViewPlanVirtualList>
{/if}
