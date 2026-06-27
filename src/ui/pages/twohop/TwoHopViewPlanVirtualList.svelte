<script lang="ts">
	import { ARIA_LABELS, IS_PROD } from "../../../appConstants";
	import { svgAttrs, ICON_PATHS } from "ui/utils/icons";
	import VirtualSurface from "ui/components/common/virtual-list/VirtualSurface.svelte";
	import type {
		MountedFlatCell,
		MountedFlatHeaderCell,
		MountedFlatItemCell,
	} from "ui/components/common/virtual-list/reconciliation/viewPlanMountedCells";
	import { setContext, type Snippet } from "svelte";
	import type { ApplicationStore } from "ui/stores/ApplicationStore.svelte";
	import type { SectionRenderDescriptor } from "ui/components/sections/types";
	import type {
		TwoHopPageVirtualSection,
		TwoHopPageVirtualItem,
	} from "./twohopPageVirtualModel";
	import { useTwoHopViewPlanVirtualList } from "./useTwoHopViewPlanVirtualList.svelte";
	import type { TwoHopVirtualListTuning } from "./twoHopVirtualListTuning";
	import type {
		VirtualizedItemVisibility,
		VirtualizedItemVisibilityState,
	} from "ui/components/common/virtualizedItemVisibility";
	import type { ItemInteractionDescriptor } from "ui/interactions/interactionTypes";
	import { createTwoHopInteractionResolverProvider } from "./twoHopInteractionResolverCache";
	import {
		createPreviewActivationScope,
		PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY,
	} from "features/preview/scheduling/previewActivationScope";
	import {
		createRowPreviewActivationRuntime,
		PREVIEW_ROW_ACTIVATION_CONTEXT_KEY,
	} from "features/preview/scheduling/rowPreviewActivationRuntime";

	interface Props {
		sections: readonly SectionRenderDescriptor<
			TwoHopPageVirtualItem,
			TwoHopPageVirtualSection
		>[];
		applicationStore?: ApplicationStore;
		initialVisibleCount?: number;
		loadMoreIncrement?: number;
		tuning?: TwoHopVirtualListTuning;
		getCellClassName?: (section: TwoHopPageVirtualSection) => string | undefined;
		getItemInteractionDescriptor: (
			item: TwoHopPageVirtualItem,
		) => ItemInteractionDescriptor | null;
		renderHeader: Snippet<
			[
				{
					section: TwoHopPageVirtualSection;
					title: string;
					totalCount: number;
					sectionId: string;
					headerProps: SectionRenderDescriptor<
						TwoHopPageVirtualItem,
						TwoHopPageVirtualSection
					>["headerProps"];
				},
			]
		>;
		renderItem: Snippet<
			[
				{
					item: TwoHopPageVirtualItem;
					section: TwoHopPageVirtualSection;
					index: number;
					rowIndex: number;
					observerRoot: HTMLElement | null;
					visibility: VirtualizedItemVisibility;
					visibilityState: VirtualizedItemVisibilityState;
					activationCandidateId: string;
				},
			]
		>;
	}

	const TWO_HOP_CELL_CLASS_NAME = "view-plan-virtual-list-cell view-plan-flow-cell";

	const props: Props = $props();
	const previewActivationScope = createPreviewActivationScope();
	const rowPreviewActivationRuntime = createRowPreviewActivationRuntime({
		scope: previewActivationScope,
	});
	setContext(PREVIEW_ACTIVATION_SCOPE_CONTEXT_KEY, previewActivationScope);
	setContext(PREVIEW_ROW_ACTIVATION_CONTEXT_KEY, rowPreviewActivationRuntime);
	const list = useTwoHopViewPlanVirtualList(props);
	const interactionDescriptorResolverProvider =
		createTwoHopInteractionResolverProvider({
			getMountedRows: () => list.mountedRows,
			resolveDescriptor: (item) => props.getItemInteractionDescriptor(item),
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
		cell: MountedFlatCell<TwoHopPageVirtualItem, TwoHopPageVirtualSection>,
	): string => resolveSectionCellClassName(props.getCellClassName?.(cell.section));
	const isHeaderCell = (
		cell: MountedFlatCell<TwoHopPageVirtualItem, TwoHopPageVirtualSection>,
	): cell is MountedFlatHeaderCell<TwoHopPageVirtualItem, TwoHopPageVirtualSection> =>
		cell.cell.kind === "header";
	const isItemCell = (
		cell: MountedFlatCell<TwoHopPageVirtualItem, TwoHopPageVirtualSection>,
	): cell is MountedFlatItemCell<TwoHopPageVirtualItem, TwoHopPageVirtualSection> =>
		cell.cell.kind === "item";
</script>

<VirtualSurface
	className="cosense-card-links__section view-plan-virtual-list twohop-page-virtual-list"
	contentClassName="view-plan-virtual-list-content view-plan-flow-content"
	rowClassName="view-plan-flow-row"
	cellClassName=""
	contentHeight={list.contentHeight}
	mountedCells={list.directRowsModeMountedCells}
	mountedRows={list.mountedRows}
	mountedRowsVersion={list.mountedRowsVersion}
	cellWidth={list.layout.cellWidth}
	rowHeight={list.layout.rowHeight}
	columns={list.layout.columns}
	gap={list.layout.gap}
	layoutMode="grid-rows"
	interactionDescriptorScopeId="twohop-mounted-items"
	{interactionDescriptorResolverProvider}
	bind:rootEl={list.rootEl}
	observerRoot={list.observerRoot}
	getCellClassName={getMountedCellClassName}
	getCellDataTestId={list.getCellDataTestId}
	resolveNavigationTarget={list.resolveNavigationTarget}
	flushVirtualScrollMeasurement={list.flushVirtualScrollMeasurement}
>
	{#snippet renderCell({ mountedCell: renderedCell, observerRoot })}
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
				list.createItemRenderArgs(renderedCell, observerRoot),
			)}
		{:else}
			<button
				type="button"
				class="cosense-card-links__load-more-button cosense-card-links__box"
				aria-label={ARIA_LABELS.LOAD_MORE}
				{...!IS_PROD
					? { "data-testid": `load-more-${renderedCell.sectionId}` }
					: {}}
				onclick={() => list.loadMore(renderedCell.sectionId)}
			>
				<svg {...svgAttrs} width="28" height="28" stroke="currentColor">
					{@html ICON_PATHS.Ellipsis}
				</svg>
			</button>
		{/if}
	{/snippet}
</VirtualSurface>
