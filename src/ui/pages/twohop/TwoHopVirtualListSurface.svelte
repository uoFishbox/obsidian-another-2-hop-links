<script lang="ts">
	import { IS_PROD } from "../../../appConstants";
	import { providePreviewActivationContexts } from "features/preview/scheduling/previewActivationContexts";
	import VirtualSurface from "ui/components/common/virtual-list/VirtualSurface.svelte";
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
	import { useTwoHopViewPlanVirtualList } from "./useTwoHopVirtualListSurface.svelte";
	import type { TwoHopVirtualListTuning } from "./twoHopVirtualListTuning";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
	import { createTwoHopInteractionResolverProvider } from "./twoHopInteractionResolverCache";

	interface Props {
		sections: readonly SectionRenderDescriptor<
			TwoHopVirtualListItem,
			TwoHopVirtualListSection
		>[];
		applicationStore?: ApplicationStore;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		tuning?: TwoHopVirtualListTuning;
		getCellClassName?: (section: TwoHopVirtualListSection) => string | undefined;
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
			[TwoHopVirtualListItem, number, VirtualizedItemVisibilityState, string]
		>;
	}

	const TWO_HOP_CELL_CLASS_NAME = "view-plan-virtual-list-cell view-plan-flow-cell";

	const props: Props = $props();
	providePreviewActivationContexts();
	const list = useTwoHopViewPlanVirtualList(props);
	const interactionDescriptorResolverProvider =
		createTwoHopInteractionResolverProvider({
			getMountedRows: () => list.mountedRows,
			resolveDescriptor: (item) => props.getItemInteractionDescriptor(item),
			getDescriptorRevision: () => props.interactionDescriptorRevision,
		});
	const resolvedCellClassNameBySectionClassName = new Map<string, string>();
	const resolveSectionCellClassName = (
		sectionClassName: string | undefined,
	): string => {
		if (!sectionClassName) return TWO_HOP_CELL_CLASS_NAME;

		let resolved = resolvedCellClassNameBySectionClassName.get(sectionClassName);
		if (resolved !== undefined) return resolved;

		resolved = `${TWO_HOP_CELL_CLASS_NAME} ${sectionClassName}`;
		resolvedCellClassNameBySectionClassName.set(sectionClassName, resolved);
		return resolved;
	};
	const getMountedCellClassName = (
		cell: MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
	): string => resolveSectionCellClassName(props.getCellClassName?.(cell.section));
	const isHeaderCell = (
		cell: MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
	): cell is MountedFlatHeaderCell<TwoHopVirtualListItem, TwoHopVirtualListSection> =>
		cell.cell.kind === "header";
	const isItemCell = (
		cell: MountedFlatCell<TwoHopVirtualListItem, TwoHopVirtualListSection>,
	): cell is MountedFlatItemCell<TwoHopVirtualListItem, TwoHopVirtualListSection> =>
		cell.cell.kind === "item";
</script>

<VirtualSurface
	className="cosense-card-links__section view-plan-virtual-list twohop-page-virtual-list"
	contentClassName="view-plan-virtual-list-content view-plan-flow-content"
	rowClassName="view-plan-flow-row"
	cellClassName=""
	contentHeight={list.contentHeight}
	mountedRows={list.mountedRows}
	cellWidth={list.layout.cellWidth}
	rowHeight={list.layout.rowHeight}
	columns={list.layout.columns}
	gap={list.layout.gap}
	layoutMode="grid-rows"
	remountCellBodyOnKeyChange={false}
	interactionDescriptorScopeId="twohop-mounted-cells"
	{interactionDescriptorResolverProvider}
	bind:rootEl={list.rootEl}
	observerRoot={list.observerRoot}
	getCellClassName={getMountedCellClassName}
	getCellDataTestId={list.getCellDataTestId}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
>
	{#snippet renderCell({ mountedCell: renderedCell })}
		{#if isHeaderCell(renderedCell)}
			{@render props.renderHeader({
				section: renderedCell.section,
				title: renderedCell.title,
				totalCount: renderedCell.totalCount,
				sectionId: renderedCell.sectionId,
				headerProps: renderedCell.headerProps,
			})}
		{:else if isItemCell(renderedCell)}
			{@render props.renderItem(
				renderedCell.cell.item,
				renderedCell.rowIndex,
				list.getItemVisibilityState(renderedCell),
				list.getItemActivationCandidateId(renderedCell),
			)}
		{:else}
			<VirtualListLoadMoreButton
				testId={!IS_PROD ? `load-more-${renderedCell.sectionId}` : undefined}
				onClick={() => list.loadMore(renderedCell.sectionId)}
			/>
		{/if}
	{/snippet}
</VirtualSurface>
