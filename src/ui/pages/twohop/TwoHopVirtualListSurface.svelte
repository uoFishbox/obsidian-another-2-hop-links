<script lang="ts">
	import { IS_PROD } from "../../../appConstants";
	import { providePreviewActivationContexts } from "features/preview/scheduling/previewActivationContexts";
	import VirtualInteractiveSurface from "ui/components/common/virtual-list/svelte/VirtualInteractiveSurface.svelte";
	import VirtualListLoadMoreButton from "ui/components/common/virtual-list/VirtualListLoadMoreButton.svelte";
	import type { Snippet } from "svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import type {
		TwoHopVirtualListSection,
		TwoHopVirtualListItem,
	} from "./twoHopVirtualListModel";
	import { createTwoHopVirtualListController } from "./twoHopVirtualListController.svelte";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
	import { createTwoHopInteractionDescriptorCache } from "./twoHopInteractionDescriptorCache";
	import TwoHopFixedRowSlotsSurface from "./TwoHopFixedRowSlotsSurface.svelte";
	import TwoHopItemCellRender from "./TwoHopItemCellRender.svelte";
	import { createSurfaceVirtualCellRegistry } from "ui/components/common/virtual-list/svelte/VirtualCellRegistry";
	import type {
		TwoHopCardPresentationState,
		TwoHopCellBinding,
		TwoHopItemCellBinding,
	} from "./twoHopCellBinding";
	import type { CardRenderModel } from "ui/components/items/cardRenderModel";
	import { provideVirtualFrameCoordinator } from "ui/virtualization/frameCoordinatorContext.svelte";

	interface Props {
		sections: readonly SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>[];
		applicationStore?: ApplicationStore;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		getItemInteractionDescriptor: (
			item: TwoHopVirtualListItem,
		) => ItemInteractionDescriptor | null;
		interactionDescriptorRevision?: unknown;
		cardModelRevision?: unknown;
		resolveItemCardModel?: (
			item: TwoHopVirtualListItem,
			presentation: TwoHopCardPresentationState,
		) => CardRenderModel;
		renderHeader: Snippet<
			[
				{
					section: TwoHopVirtualListSection;
					title: string;
					totalCount: number;
					sectionId: string;
					headerProps: SectionRenderDescriptor<
						TwoHopVirtualListItem,
						TwoHopVirtualListSection
					>["headerProps"];
				},
			]
		>;
		renderItem: Snippet<
			[
				TwoHopVirtualListItem,
				number,
				string,
				TwoHopCardPresentationState,
				CardRenderModel | null,
			]
		>;
	}

	const EMPTY_MOUNTED_ROWS: readonly [] = [];

	const props: Props = $props();
	const cellRegistry = createSurfaceVirtualCellRegistry();
	let contentEl = $state<HTMLDivElement | null>(null);
	const frameCoordinator = provideVirtualFrameCoordinator();
	providePreviewActivationContexts({ frameCoordinator });
	const list = createTwoHopVirtualListController(props, { frameCoordinator });
	const interactionDescriptorResolverProvider =
		createTwoHopInteractionDescriptorCache({
			getMountedCellByInteractionId: list.getMountedCellByInteractionId,
			resolveDescriptor: (item) => props.getItemInteractionDescriptor(item),
			getDescriptorRevision: () => props.interactionDescriptorRevision,
		});
	// Entries for removed interaction ids cannot evict themselves after an input update.
	$effect(() => {
		void props.sections;
		void props.interactionDescriptorRevision;
		interactionDescriptorResolverProvider.invalidate();
	});
	const isHeaderCell = (binding: TwoHopCellBinding): boolean =>
		binding.compiledCell.logicalCell.kind === "header";
	const fixedSurfaceLayoutKey = $derived(list.layout.columns);
	const isItemCell = (
		binding: TwoHopCellBinding,
	): binding is TwoHopItemCellBinding =>
		binding.compiledCell.logicalCell.kind === "item";
</script>

<VirtualInteractiveSurface
	className="cosense-card-links__section view-plan-virtual-list twohop-page-virtual-list"
	rowHeight={list.layout.rowHeight}
	layoutMode="grid-rows"
	mountedRows={EMPTY_MOUNTED_ROWS}
	interactionDescriptorScopeId="twohop-mounted-cells"
	{interactionDescriptorResolverProvider}
	bind:rootEl={list.rootEl}
	bind:contentEl
	observerRoot={list.observerRoot}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushScrollMeasurement}
	{cellRegistry}
>
	{#key fixedSurfaceLayoutKey}
		<TwoHopFixedRowSlotsSurface
			contentClassName="view-plan-virtual-list-content view-plan-flow-content"
			rowClassName="view-plan-flow-row"
			contentHeight={list.contentHeight}
			rowSlotControllers={list.rowSlotControllers}
			cellWidth={list.layout.cellWidth}
			rowHeight={list.layout.rowHeight}
			columns={list.layout.columns}
			gap={list.layout.gap}
			bind:contentEl
			observerRoot={list.observerRoot}
			getCellDataTestId={list.getCellDataTestId}
			{cellRegistry}
		>
			{#snippet renderCell({ binding, rowFrame, cellController })}
				{#if isHeaderCell(binding)}
					{@const descriptor = rowFrame.sectionPlan.descriptor}
					{@render props.renderHeader({
						section: descriptor.section,
						title: descriptor.title,
						totalCount: descriptor.totalCount,
						sectionId: descriptor.sectionId,
						headerProps: descriptor.headerProps,
					})}
				{:else if isItemCell(binding)}
					<TwoHopItemCellRender
						{cellController}
						getItemActivationCandidateId={list.getItemActivationCandidateId}
						renderItem={props.renderItem}
					/>
				{:else}
					<VirtualListLoadMoreButton
						testId={!IS_PROD
							? `load-more-${rowFrame.sectionPlan.sectionId}`
							: undefined}
						onClick={() => list.loadMore(rowFrame.sectionPlan.sectionId)}
					/>
				{/if}
			{/snippet}
		</TwoHopFixedRowSlotsSurface>
	{/key}
</VirtualInteractiveSurface>
