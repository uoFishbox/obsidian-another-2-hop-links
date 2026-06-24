<script lang="ts">
	import { getContext } from "svelte";
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import TwoHopViewPlanVirtualList from "./TwoHopViewPlanVirtualList.svelte";
	import ClickableHeader from "ui/components/common/ClickableHeader.svelte";
	import LinkSectionHeader from "ui/components/common/LinkSectionHeader.svelte";
	import ViewItemCard from "ui/components/items/ViewItemCard.svelte";
	import PreviewVisibilityProvider from "ui/components/items/PreviewVisibilityProvider.svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type {
		SearchWorkerMatchedItem,
		SearchWorkerMatchScope,
	} from "features/search/searchWorkerTypes";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtualizedItemVisibility";
	import type { VirtualizedItemVisibility } from "ui/components/common/virtual-list/types";
	import type {
		TwoHopPageVirtualSection,
		TwoHopPageVirtualItem,
		TwoHopSectionDescriptor,
	} from "./twohopPageVirtualModel";
	import { resolveTwoHopPageItemSearchScope } from "./twohopPageVirtualModel";
	import { useLinkContext } from "ui/context/linkContext";
	import {
		createItemInteractionDescriptor,
		createItemInteractionKey,
	} from "ui/interactions/interactionTypes";

	interface Props {
		sections: readonly TwoHopSectionDescriptor[];
		applicationStore?: ApplicationStore;
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
	const renderableDescriptors = $derived(sections);

	const resolveItemSearchScope = (
		row: TwoHopPageVirtualItem,
	): SearchWorkerMatchScope =>
		resolveTwoHopPageItemSearchScope(
			row,
			searchScope,
			matchedItemByKey?.get(row.searchKey)?.contentMatched,
		);

	const resolveItemContentPreview = (
		row: TwoHopPageVirtualItem,
	): string | undefined => matchedItemByKey?.get(row.searchKey)?.contentPreview;

	const getCellClassName = (section: TwoHopPageVirtualSection): string | undefined =>
		section.className;

	const getItemInteractionDescriptor = (row: TwoHopPageVirtualItem) =>
		linkContext
			? createItemInteractionDescriptor(
					row.item,
					currentSettings,
					searchQuery,
					linkContext,
					{
						interactionId: row.interactionId,
						interactionKey:
							row.interactionKey ?? createItemInteractionKey(row.item),
					},
				)
			: null;

	type RenderItemArgs = {
		item: TwoHopPageVirtualItem;
		section: TwoHopPageVirtualSection;
		index: number;
		rowIndex: number;
		observerRoot: HTMLElement | null;
		visibilityState: VirtualizedItemVisibilityState;
		visibility: VirtualizedItemVisibility;
		activationCandidateId: string;
	};
</script>

{#if renderableDescriptors.length > 0}
	<TwoHopViewPlanVirtualList
		sections={renderableDescriptors}
		{applicationStore}
		{initialVisibleCount}
		{loadMoreIncrement}
		{getCellClassName}
		{getItemInteractionDescriptor}
	>
		{#snippet renderHeader({ section, title, totalCount, sectionId, headerProps })}
			{#if section.kind === "primary-section"}
				<LinkSectionHeader {title} {totalCount} />
			{:else if section.kind === "new-links-section"}
				<LinkSectionHeader {title} {totalCount}>
					{#snippet icon()}
						<svg
							{...svgAttrs}
							width="26"
							height="26"
							stroke="currentColor"
							class="twohop-links-icon"
						>
							{@html ICON_PATHS.Unlink}
						</svg>
					{/snippet}
				</LinkSectionHeader>
			{:else if section.kind === "two-hop-branch"}
				<ClickableHeader
					title={section.title}
					count={totalCount}
					{...headerProps}
					interactionId={headerProps.interactionId ?? sectionId}
					interactionKind={headerProps.interactionKind ?? "sectionHeader"}
				>
					{#snippet icon()}
						<svg
							{...svgAttrs}
							width="26"
							height="26"
							stroke="currentColor"
							class="twohop-links-icon"
						>
							{@html ICON_PATHS.Link}
						</svg>
					{/snippet}
				</ClickableHeader>
			{:else if section.kind === "tag-section"}
				<ClickableHeader
					title={section.title}
					count={totalCount}
					{...headerProps}
					interactionId={headerProps.interactionId ?? sectionId}
					interactionKind={headerProps.interactionKind ?? "sectionHeader"}
				>
					{#snippet icon()}
						<svg
							{...svgAttrs}
							width="26"
							height="26"
							stroke="currentColor"
							class="twohop-links-icon"
						>
							{@html ICON_PATHS.Tag}
						</svg>
					{/snippet}
				</ClickableHeader>
			{/if}
		{/snippet}

		{#snippet renderItem(args: RenderItemArgs)}
			{@const row = args?.item}

			{#if row}
				<PreviewVisibilityProvider visibilityState={args?.visibilityState}>
					<ViewItemCard
						item={row.item}
						settings={currentSettings}
						{searchQuery}
						searchScope={resolveItemSearchScope(row)}
						contentPreview={resolveItemContentPreview(row)}
						observerRoot={args?.observerRoot ?? null}
						rowIndex={args?.rowIndex}
						activationCandidateId={args?.activationCandidateId}
						interactionRegistration="snapshot"
						interactionId={row.interactionId}
						interactionKey={row.interactionKey}
					/>
				</PreviewVisibilityProvider>
			{/if}
		{/snippet}
	</TwoHopViewPlanVirtualList>
{/if}
