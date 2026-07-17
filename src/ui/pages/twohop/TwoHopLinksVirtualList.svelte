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
	} from "./twoHopVirtualListModel";
	import { useLinkContext } from "ui/context/linkContext";
	import {
		createTwoHopInteractionDescriptorRevision,
		resolveTwoHopItemInteractionDescriptor,
	} from "./twoHopInteractionDescriptorRevision";
	import type { TwoHopCardPresentationState } from "./twoHopCellBinding";
	import {
		createTwoHopCardRenderModelCache,
		type TwoHopCardModelRevision,
	} from "./twoHopCardRenderModelCache";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import type { LinkUtilitiesContext } from "types/linkContext";

	interface Props {
		sections: readonly TwoHopVirtualSectionDescriptor[];
		applicationStore: ApplicationStore;
		searchQuery?: string;
		searchScope?: SearchWorkerMatchScope;
		matchedItemByKey?: Map<string, SearchWorkerMatchedItem> | null;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		linkContext?: LinkUtilitiesContext;
	}

	let {
		sections,
		applicationStore,
		searchQuery = "",
		searchScope = "title-and-content",
		matchedItemByKey = null,
		initialVisibleCount,
		loadMoreIncrement,
		linkContext: providedLinkContext = undefined,
	}: Props = $props();

	if (!applicationStore) {
		applicationStore = getContext<ApplicationStore>("applicationStore");
	}

	const currentSettings = $derived(applicationStore.settings);
	let linkContext = providedLinkContext;
	if (!linkContext) {
		try {
			linkContext = useLinkContext();
		} catch {
			linkContext = undefined;
		}
	}
	const cardModelCache = createTwoHopCardRenderModelCache();
	const cardModelRevision = $derived.by(
		(): TwoHopCardModelRevision | undefined =>
			linkContext
				? {
					settings: currentSettings,
					searchQuery,
					searchScope,
					matchedItemByKey,
					linkContext,
					applicationStore,
					applicationUpdateVersion: applicationStore.updateVersion,
					previewGlobalVersion: applicationStore.previewGlobalVersion,
					previewPathVersions: applicationStore.previewPathVersions,
				}
				: undefined,
	);
	const resolveItemCardModel = $derived.by(() => {
		const revision = cardModelRevision;
		if (!revision) return undefined;
		return (
			row: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		): CardRenderModel => cardModelCache.resolve(row, presentation, revision);
	});
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
		{getItemInteractionDescriptor}
		{interactionDescriptorRevision}
		{cardModelRevision}
		{resolveItemCardModel}
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

		{#snippet renderItem(
			row: TwoHopVirtualListItem,
			rowIndex: number,
			activationCandidateId: string,
			presentation: TwoHopCardPresentationState,
			model: CardRenderModel | null,
		)}
			<TwoHopVirtualItemCard
				{row}
				settings={currentSettings}
				{searchQuery}
				{searchScope}
				{matchedItemByKey}
				{rowIndex}
				{activationCandidateId}
				{presentation}
				{model}
			/>
		{/snippet}
	</TwoHopViewPlanVirtualList>
{/if}
