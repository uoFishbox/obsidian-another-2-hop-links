<script lang="ts">
	import { IS_PROD } from "../../../appConstants";
	import { providePreviewActivationContexts } from "features/preview/scheduling/previewActivationContexts";
	import VirtualInteractiveSurface from "ui/components/common/virtual-list/svelte/VirtualInteractiveSurface.svelte";
	import VirtualListLoadMoreButton from "ui/components/common/virtual-list/VirtualListLoadMoreButton.svelte";
	import type { VirtualizedItemVisibilityState } from "ui/components/common/virtual-list/types";
	import type {
		MountedFlatCell,
		MountedFlatHeaderCell,
		MountedFlatItemCell,
	} from "ui/components/common/virtual-list/core/reconciliation/viewPlanMountedCells";
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
	import type { TwoHopCardPresentationState } from "./twoHopCellBinding";

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
				VirtualizedItemVisibilityState,
				string,
				TwoHopCardPresentationState,
			]
		>;
	}

	const EMPTY_MOUNTED_ROWS: readonly [] = [];

	const props: Props = $props();
	const cellRegistry = createSurfaceVirtualCellRegistry();
	let contentEl = $state<HTMLDivElement | null>(null);
	providePreviewActivationContexts();
	const list = createTwoHopVirtualListController(props);
	const interactionDescriptorResolverProvider =
		createTwoHopInteractionDescriptorCache({
			getMountedRows: () => list.mountedRows,
			resolveDescriptor: (item) => props.getItemInteractionDescriptor(item),
			getDescriptorRevision: () => props.interactionDescriptorRevision,
		});
	const isHeaderCell = (
		cell: MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
	): cell is MountedFlatHeaderCell<TwoHopVirtualListItem, TwoHopVirtualListSection> =>
		cell.cell.kind === "header";
	const fixedSurfaceLayoutKey = $derived(list.layout.columns);
	const isItemCell = (
		cell: MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
	): cell is MountedFlatItemCell<TwoHopVirtualListItem, TwoHopVirtualListSection> =>
		cell.cell.kind === "item";
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
			{#snippet renderCell({ mountedCell: renderedCell, cellController })}
				{#if isHeaderCell(renderedCell)}
					{@render props.renderHeader({
						section: renderedCell.section,
						title: renderedCell.title,
						totalCount: renderedCell.totalCount,
						sectionId: renderedCell.sectionId,
						headerProps: renderedCell.headerProps,
					})}
				{:else if isItemCell(renderedCell)}
					<TwoHopItemCellRender
						{cellController}
						getItemVisibilityState={list.getItemVisibilityState}
						getItemActivationCandidateId={list.getItemActivationCandidateId}
						renderItem={props.renderItem}
					/>
				{:else}
					<VirtualListLoadMoreButton
						testId={!IS_PROD
							? `load-more-${renderedCell.sectionId}`
							: undefined}
						onClick={() => list.loadMore(renderedCell.sectionId)}
					/>
				{/if}
			{/snippet}
		</TwoHopFixedRowSlotsSurface>
	{/key}
</VirtualInteractiveSurface>
